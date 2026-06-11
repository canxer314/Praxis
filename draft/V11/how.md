# How does Praxis V11 work?

> V11 的核心实现：知识查询 API、认知指导信号生成、任务结果反馈处理、会话中实时矛盾检测、ProtoTask Phase 1 核心（含 bootstrap）。

---

## 一、知识查询 API（接口 1）

```typescript
// api/knowledge-query.ts

interface KnowledgeQuery {
  query_type: 'proto_task' | 'relevant_structures' | 'pitfalls' | 'phase_guidance';
  task_type?: string;
  task_name?: string;
  current_phase?: string;
  scenario_ids?: string[];
  max_results?: number;                // 默认 5
}

interface KnowledgeQueryResult {
  query_type: string;
  results: any[];                      // ProtoTask | ProtoStructure[] | pitfalls[]
  result_count: number;
  confidence: number;                  // 结果整体的平均置信度
  source: 'proto_task' | 'proto_structures' | 'llm_general' | 'none';
  note?: string;
  cached_at?: number;
}

// ── 主查询函数 ──

async function queryKnowledge(q: KnowledgeQuery): Promise<KnowledgeQueryResult> {
  switch (q.query_type) {
    case 'proto_task':
      return queryProtoTask(q);
    case 'relevant_structures':
      return queryRelevantStructures(q);
    case 'pitfalls':
      return queryPitfalls(q);
    case 'phase_guidance':
      return queryPhaseGuidance(q);
    default:
      return { query_type: q.query_type, results: [], result_count: 0,
               confidence: 0, source: 'none', note: 'Unknown query_type' };
  }
}

// ── ProtoTask 查询 ──

async function queryProtoTask(q: KnowledgeQuery): Promise<KnowledgeQueryResult> {
  if (!q.task_type) {
    return { query_type: 'proto_task', results: [], result_count: 0,
             confidence: 0, source: 'none', note: 'task_type is required' };
  }

  // 1. 从 proto_task slot 读取
  let protoTask = await memorySlotGet('proto_task').catch(() => null);

  // 2. 如果存在且匹配 → 直接返回
  if (protoTask && protoTask.task_type === q.task_type) {
    return {
      query_type: 'proto_task',
      results: [protoTask],
      result_count: 1,
      confidence: protoTask.confidence,
      source: protoTask.observations_count > 0 ? 'proto_task' : 'llm_general',
    };
  }

  // 3. 如果不存在 → 尝试从 task_history 构造
  const completedTasks = await memorySmartSearch(q.task_type, { type: 'task_history' });
  if (completedTasks.length > 0) {
    protoTask = await constructProtoTask(q.task_type, completedTasks, []);
    await memorySlotSet('proto_task', protoTask);
    return {
      query_type: 'proto_task',
      results: [protoTask],
      result_count: 1,
      confidence: protoTask.confidence,
      source: 'proto_task',
    };
  }

  // 4. 零样本 → bootstrap
  if (config.knowledgeQuery.allowBootstrap) {
    protoTask = await bootstrapProtoTask(q.task_type);
    await memorySlotSet('proto_task', protoTask);
    return {
      query_type: 'proto_task',
      results: [protoTask],
      result_count: 1,
      confidence: protoTask.confidence,
      source: 'llm_general',
      note: '零样本 Bootstrap — 基于 LLM 通用知识，非团队特定经验。置信度低，仅供参考。',
    };
  }

  return { query_type: 'proto_task', results: [], result_count: 0,
           confidence: 0, source: 'none', note: 'No data available and bootstrap disabled' };
}

// ── 相关结构查询 ──

async function queryRelevantStructures(q: KnowledgeQuery): Promise<KnowledgeQueryResult> {
  const scenarioIds = q.scenario_ids ?? [];
  const phase = q.current_phase;

  // 1. 如果有 ProtoTask，从对应 phase 获取推荐结构
  let recommendedIds: string[] = [];
  if (phase && q.task_type) {
    const protoTaskResult = await queryProtoTask({ query_type: 'proto_task', task_type: q.task_type });
    if (protoTaskResult.results.length > 0) {
      const pt = protoTaskResult.results[0] as ProtoTask;
      const phaseEntry = pt.typical_phases.find(p => p.name === phase);
      if (phaseEntry) {
        recommendedIds = phaseEntry.relevant_structure_ids;
      }
    }
  }

  // 2. 从 AgentMemory 加载对应的 ProtoStructure 和 CognitiveStructure
  const allStructures = await loadAllStructures();
  const relevant = allStructures.filter(s => {
    const sid = (s as any).scenario_id ?? (s as any).applies_to?.[0] ?? '';
    return scenarioIds.includes(sid) || recommendedIds.includes((s as any).proto_id);
  });

  const maxResults = q.max_results ?? 5;
  const sorted = relevant
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, maxResults);

  return {
    query_type: 'relevant_structures',
    results: sorted,
    result_count: sorted.length,
    confidence: sorted.length > 0
      ? sorted.reduce((s, r) => s + (r.confidence ?? 0), 0) / sorted.length
      : 0,
    source: recommendedIds.length > 0 ? 'proto_task' : 'proto_structures',
  };
}

// ── 陷阱查询 ──

async function queryPitfalls(q: KnowledgeQuery): Promise<KnowledgeQueryResult> {
  if (!q.task_type) {
    return { query_type: 'pitfalls', results: [], result_count: 0,
             confidence: 0, source: 'none' };
  }

  const protoTaskResult = await queryProtoTask({ query_type: 'proto_task', task_type: q.task_type });
  if (protoTaskResult.results.length === 0) {
    return { query_type: 'pitfalls', results: [], result_count: 0,
             confidence: 0, source: 'none' };
  }

  const pt = protoTaskResult.results[0] as ProtoTask;
  let pitfalls = pt.common_pitfalls;

  // 如果指定了 current_phase，只返回该 phase 相关的陷阱
  if (q.current_phase) {
    pitfalls = pitfalls.filter(p => p.affected_phases.includes(q.current_phase));
  }

  return {
    query_type: 'pitfalls',
    results: pitfalls,
    result_count: pitfalls.length,
    confidence: pt.confidence,
    source: protoTaskResult.source,
  };
}

// ── Phase 指导查询 ──

async function queryPhaseGuidance(q: KnowledgeQuery): Promise<KnowledgeQueryResult> {
  const protoTaskResult = await queryProtoTask({ query_type: 'proto_task', task_type: q.task_type });
  const structuresResult = await queryRelevantStructures(q);
  const pitfallsResult = await queryPitfalls(q);

  return {
    query_type: 'phase_guidance',
    results: [{
      proto_task: protoTaskResult.results[0] ?? null,
      relevant_structures: structuresResult.results,
      pitfalls: pitfallsResult.results,
      suggested_next: suggestNextActions(
        protoTaskResult.results[0] as ProtoTask | null,
        q.current_phase ?? null
      ),
    }],
    result_count: 1,
    confidence: protoTaskResult.confidence,
    source: protoTaskResult.source,
  };
}

function suggestNextActions(protoTask: ProtoTask | null, currentPhase: string | null): string[] {
  if (!protoTask || !currentPhase) return [];
  const phaseIndex = protoTask.typical_phases.findIndex(p => p.name === currentPhase);
  if (phaseIndex < 0) return [];

  const suggestions: string[] = [];

  // 当前阶段的陷阱
  const currentPitfalls = protoTask.common_pitfalls
    .filter(p => p.affected_phases.includes(currentPhase));
  for (const p of currentPitfalls) {
    suggestions.push(`⚠ ${p.description} — ${p.mitigation}`);
  }

  // 下一阶段的准备
  if (phaseIndex + 1 < protoTask.typical_phases.length) {
    const next = protoTask.typical_phases[phaseIndex + 1];
    suggestions.push(`准备进入 "${next.name}": 关注 ${next.key_scenarios.join(', ')}`);
  }

  return suggestions;
}
```

---

## 二、认知指导信号生成（接口 2）

```typescript
// orchestration/cognitive-guidance.ts

type GuidanceSignalType =
  | 'phase_suggestion'
  | 'pitfall_warning'
  | 'structure_recommendation'
  | 'contradiction_alert'
  | 'confidence_advisory';

interface GuidanceSignal {
  signal_id: string;
  signal_type: GuidanceSignalType;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  detail?: string;
  source_structures: string[];
  confidence: number;
  suggested_action?: string;
  created_at: number;
}

// ── 主生成函数 ──

function generateGuidanceSignals(
  taskContext: TaskContext | null,
  sceneRecognition: SceneRecognitionResult,
  protoTask: ProtoTask | null,
  protoStructures: ProtoStructure[],
  cognitiveStructures: CognitiveStructure[],
  midSessionContradictions?: MidSessionContradiction[]
): GuidanceSignal[] {
  const signals: GuidanceSignal[] = [];
  let signalCounter = 0;

  const nextId = () => `guidance_${Date.now()}_${signalCounter++}`;

  // 1. Phase 建议 (基于 ProtoTask)
  if (taskContext && protoTask && taskContext.current_phase) {
    const phaseEntry = protoTask.typical_phases.find(
      p => p.name === taskContext.current_phase
    );
    if (phaseEntry && protoTask.confidence >= config.cognitiveGuidance.minConfidenceForWarning) {
      signals.push({
        signal_id: nextId(),
        signal_type: 'phase_suggestion',
        severity: 'info',
        summary: `当前 Phase: ${phaseEntry.name} (通常 ${phaseEntry.typical_duration})`,
        detail: `关键场景: ${phaseEntry.key_scenarios.join(', ')}`,
        source_structures: phaseEntry.relevant_structure_ids,
        confidence: protoTask.confidence,
        suggested_action: `关注 ${phaseEntry.key_scenarios.slice(0, 3).join('、')}`,
        created_at: Date.now(),
      });
    }
  }

  // 2. 陷阱预警 (基于 ProtoTask)
  if (taskContext && protoTask) {
    const currentPitfalls = protoTask.common_pitfalls.filter(p =>
      !taskContext.current_phase || p.affected_phases.includes(taskContext.current_phase)
    );

    for (const pitfall of currentPitfalls.slice(0, 2)) { // 最多 2 个陷阱预警
      if (signals.length >= config.cognitiveGuidance.maxSignalsPerInjection) break;
      signals.push({
        signal_id: nextId(),
        signal_type: 'pitfall_warning',
        severity: 'warning',
        summary: `⚠ 已知陷阱: ${pitfall.description}`,
        detail: `影响阶段: ${pitfall.affected_phases.join(', ')}。缓解: ${pitfall.mitigation}`,
        source_structures: [],
        confidence: protoTask.confidence,
        suggested_action: pitfall.mitigation,
        created_at: Date.now(),
      });
    }
  }

  // 3. 结构推荐
  if (signals.length < config.cognitiveGuidance.maxSignalsPerInjection) {
    const recommendedIds = protoTask?.typical_phases
      .find(p => p.name === taskContext?.current_phase)
      ?.relevant_structure_ids ?? [];

    const relevantStructures = [...protoStructures, ...cognitiveStructures]
      .filter(s => {
        const sid = (s as any).proto_id ?? (s as any).id ?? '';
        return recommendedIds.includes(sid) ||
               sceneRecognition.scenario_id === ((s as any).scenario_id ?? (s as any).applies_to?.[0]);
      })
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 3);

    if (relevantStructures.length > 0) {
      signals.push({
        signal_id: nextId(),
        signal_type: 'structure_recommendation',
        severity: 'info',
        summary: `推荐关注结构: ${relevantStructures.map(s =>
          (s as any).tentative_name ?? (s as any).name ?? 'unknown').join(', ')}`,
        detail: relevantStructures.map(s =>
          `- ${(s as any).tentative_name ?? (s as any).name}: 置信度 ${(s.confidence ?? 0).toFixed(2)}`
        ).join('\n'),
        source_structures: relevantStructures.map(s => (s as any).proto_id ?? (s as any).id ?? ''),
        confidence: relevantStructures.reduce((s, r) => s + (r.confidence ?? 0), 0) / relevantStructures.length,
        created_at: Date.now(),
      });
    }
  }

  // 4. 矛盾告警 (基于 mid-session 检测)
  if (midSessionContradictions && midSessionContradictions.length > 0 && signals.length < config.cognitiveGuidance.maxSignalsPerInjection) {
    const criticalContradictions = midSessionContradictions.filter(c => c.severity === 'critical');
    if (criticalContradictions.length > 0) {
      signals.push({
        signal_id: nextId(),
        signal_type: 'contradiction_alert',
        severity: 'critical',
        summary: `检测到 ${criticalContradictions.length} 个严重认知矛盾`,
        detail: criticalContradictions.map(c => `- ${c.evidence}`).join('\n'),
        source_structures: criticalContradictions.map(c => c.proto_id),
        confidence: 0.8, // 矛盾检测的置信度基于规则匹配的确定性
        suggested_action: '建议暂停依赖这些认知结构的决策，等待 session_end 重新分析',
        created_at: Date.now(),
      });
    }
  }

  // 5. 置信度提醒 (低置信度结构)
  if (signals.length < config.cognitiveGuidance.maxSignalsPerInjection) {
    const lowConfidenceStructures = [...protoStructures, ...cognitiveStructures]
      .filter(s => (s.confidence ?? 0) > 0 && (s.confidence ?? 0) < 0.4)
      .slice(0, 2);

    if (lowConfidenceStructures.length > 0 && protoTask && protoTask.confidence < 0.5) {
      signals.push({
        signal_id: nextId(),
        signal_type: 'confidence_advisory',
        severity: 'info',
        summary: `当前 ProtoTask 置信度较低 (${protoTask.confidence.toFixed(2)})，阶段建议仅供参考`,
        detail: `随着同类项目积累，ProtoTask 会变得更可靠。当前基于 ${protoTask.observations_count} 次观察。`,
        source_structures: [],
        confidence: 1.0,
        created_at: Date.now(),
      });
    }
  }

  return signals.slice(0, config.cognitiveGuidance.maxSignalsPerInjection);
}

// ── GuidanceSignal 序列化（注入到 prompt） ──

function formatGuidanceSignalsForPrompt(signals: GuidanceSignal[]): string {
  if (signals.length === 0) return '';

  const lines: string[] = [];
  lines.push('## ⚠ 认知指导 [Praxis V11]');

  for (const signal of signals) {
    const severityMarker = signal.severity === 'critical' ? '🔴' :
                           signal.severity === 'warning' ? '⚠' : 'ℹ';
    const typeLabel = signal.signal_type === 'phase_suggestion' ? '阶段建议' :
                      signal.signal_type === 'pitfall_warning' ? '陷阱预警' :
                      signal.signal_type === 'structure_recommendation' ? '结构推荐' :
                      signal.signal_type === 'contradiction_alert' ? '矛盾告警' : '置信度提醒';

    lines.push(`[${typeLabel}] ${severityMarker} ${signal.summary} (置信度 ${signal.confidence.toFixed(2)})`);

    if (signal.detail && signal.severity !== 'info') {
      lines.push(`  ${signal.detail}`);
    }
    if (signal.suggested_action) {
      lines.push(`  → ${signal.suggested_action}`);
    }
  }

  return lines.join('\n');
  // 总计 ~50-150 tokens
}

// ── GuidanceSignal 结构化输出（供 OpenClaw 解析） ──

function serializeGuidanceSignalsForOpenClaw(signals: GuidanceSignal[]): object {
  return {
    version: 'v11',
    generated_at: Date.now(),
    signal_count: signals.length,
    signals: signals.map(s => ({
      type: s.signal_type,
      severity: s.severity,
      confidence: s.confidence,
      suggested_action: s.suggested_action ?? null,
      source_structures: s.source_structures,
    })),
  };
}
```

---

## 三、任务结果反馈处理（接口 3）

```typescript
// analysis/outcome-feedback.ts

interface SubtaskOutcome {
  subtask_id: string;
  subtask_name: string;
  outcome: 'success' | 'partial_success' | 'failure' | 'abandoned';

  proto_structures_used: string[];     // STRUCTURE_USED 标记汇总
  proto_task_id?: string;
  task_id: string;                     // 所属任务 ID

  completion_criteria_met: string[];
  completion_criteria_missed: string[];
  user_feedback?: string;
  rework_needed: boolean;

  started_at: number;
  completed_at: number;
  actual_duration_minutes: number;
  estimated_duration_minutes?: number;
}

interface OutcomeFeedbackResult {
  confidence_adjustments: {
    proto_id: string;
    old_confidence: number;
    new_confidence: number;
    reason: string;
  }[];
  proto_task_updates?: {
    phase_name?: string;
    duration_correction?: number;
    pitfall_id?: string;
    pitfall_observed: boolean;
    new_challenge?: string;
  };
  processed_at: number;
}

// ── 主处理函数 ──

async function processOutcomeFeedback(
  outcome: SubtaskOutcome,
  allStructures: (ProtoStructure | CognitiveStructure)[],
  protoTask: ProtoTask | null,
  config: PraxisConfig
): Promise<OutcomeFeedbackResult> {
  const adjustments: OutcomeFeedbackResult['confidence_adjustments'] = [];
  const cfg = config.outcomeFeedback;

  // 1. 对每个使用的结构，根据结果调整置信度
  for (const protoId of outcome.proto_structures_used) {
    const structure = allStructures.find(s => {
      const id = (s as any).proto_id ?? (s as any).id ?? '';
      return id === protoId;
    });
    if (!structure) continue;

    const oldConf = structure.confidence ?? 0;
    let newConf = oldConf;
    let reason = '';

    switch (outcome.outcome) {
      case 'success':
        newConf = Math.min(1.0, oldConf + cfg.successBoost);
        reason = `子任务 "${outcome.subtask_name}" 成功 → 置信度 +${cfg.successBoost}`;
        break;
      case 'partial_success':
        newConf = Math.min(1.0, oldConf + cfg.partialSuccessBoost);
        reason = `子任务 "${outcome.subtask_name}" 部分成功 → 置信度 +${cfg.partialSuccessBoost} (标记不确定性)`;
        break;
      case 'failure':
        newConf = Math.max(0, oldConf - cfg.failurePenalty);
        reason = `子任务 "${outcome.subtask_name}" 失败 → 置信度 -${cfg.failurePenalty}`;
        break;
      case 'abandoned':
        newConf = Math.max(0, oldConf - cfg.abandonedPenalty);
        reason = `子任务 "${outcome.subtask_name}" 放弃 → 置信度 -${cfg.abandonedPenalty}`;
        break;
    }

    if (newConf !== oldConf) {
      adjustments.push({ proto_id: protoId, old_confidence: oldConf,
                         new_confidence: newConf, reason });
      structure.confidence = newConf;
    }
  }

  // 2. ProtoTask 更新
  let protoTaskUpdates: OutcomeFeedbackResult['proto_task_updates'];
  if (protoTask && outcome.outcome === 'failure') {
    protoTaskUpdates = { pitfall_observed: false };

    // 检查失败是否匹配已知陷阱
    for (const pitfall of protoTask.common_pitfalls) {
      const userFeedbackLower = (outcome.user_feedback ?? '').toLowerCase();
      const pitfallDescLower = pitfall.description.toLowerCase();
      // 简单的关键词重叠检测
      const overlap = pitfallDescLower.split(/\s+/).filter(w =>
        w.length > 2 && userFeedbackLower.includes(w)
      ).length;
      if (overlap >= 3) {
        // 陷阱预测命中 → 强化 pitfall
        protoTaskUpdates.pitfall_id = pitfall.description;
        protoTaskUpdates.pitfall_observed = true;
        // 提升 ProtoTask 置信度
        protoTask.confidence = Math.min(1.0, protoTask.confidence + cfg.pitfallMatchBoost);
        break;
      }
    }

    // 如果没有匹配已知陷阱 → 可能是新挑战
    if (!protoTaskUpdates.pitfall_observed && outcome.user_feedback) {
      protoTaskUpdates.new_challenge = outcome.user_feedback;
    }
  }

  // 3. 阶段时长修正
  if (protoTask && outcome.estimated_duration_minutes) {
    const deviation = Math.abs(outcome.actual_duration_minutes - outcome.estimated_duration_minutes)
                    / outcome.estimated_duration_minutes;
    if (deviation < 0.2) {
      // 偏差 < 20% → 时长估计准确 → ProtoTask 置信度微升
      protoTask.confidence = Math.min(1.0, protoTask.confidence + cfg.durationAccuracyBoost);
      if (!protoTaskUpdates) protoTaskUpdates = { pitfall_observed: false };
      protoTaskUpdates.duration_correction = outcome.actual_duration_minutes - outcome.estimated_duration_minutes;
    }
  }

  // 4. 持久化
  await memorySave('task_outcomes', outcome);

  if (protoTask && protoTaskUpdates) {
    await memorySlotSet('proto_task', protoTask);
  }

  return {
    confidence_adjustments: adjustments,
    proto_task_updates: protoTaskUpdates,
    processed_at: Date.now(),
  };
}

// ── session_end 批量处理 ──

async function processSessionOutcomes(
  sessionId: string,
  allStructures: (ProtoStructure | CognitiveStructure)[],
  protoTask: ProtoTask | null,
  config: PraxisConfig
): Promise<OutcomeFeedbackResult[]> {
  // 从 AgentMemory 查询本次会话中积累的所有 SubtaskOutcome
  const outcomes = await memorySmartSearch(sessionId, {
    type: 'task_outcomes',
    limit: 50,
  });

  const results: OutcomeFeedbackResult[] = [];
  for (const outcome of outcomes) {
    const result = await processOutcomeFeedback(outcome, allStructures, protoTask, config);
    results.push(result);
  }

  return results;
}
```

---

## 四、会话中实时学习（接口 4）

```typescript
// analysis/mid-session-learner.ts

interface MidSessionContradiction {
  type: 'user_correction' | 'tool_mismatch' | 'sequence_violation' | 'role_inconsistency';
  detected_at: number;
  proto_id: string;
  evidence: string;
  severity: 'minor' | 'moderate' | 'critical';
}

// ── 会话级状态 ──

const sessionContradictionCount = new Map<string, number>();     // proto_id → 违反次数
const sessionContradictions: MidSessionContradiction[] = [];     // 本次会话所有矛盾

// ── message_received hook: 用户纠正检测 ──

function detectUserCorrection(
  userMessage: string,
  activeProtoStructures: ProtoStructure[]
): MidSessionContradiction[] {
  const contradictions: MidSessionContradiction[] = [];

  // 纠正模式（不调 LLM，纯规则匹配）
  const correctionPatterns = [
    { regex: /不对[，,。.]?\s*(.+)/, severity: 'moderate' as const },
    { regex: /不是这样[的]?[，,。.]?\s*(.+)/, severity: 'moderate' as const },
    { regex: /纠正一下[：:]\s*(.+)/, severity: 'critical' as const },
    { regex: /应该是[：:]?\s*(.+)/, severity: 'moderate' as const },
    { regex: /实际上[，,。.]?\s*(.+)/, severity: 'minor' as const },
    { regex: /改了[，,。.]?\s*(.+)/, severity: 'moderate' as const },
  ];

  for (const pattern of correctionPatterns) {
    const match = userMessage.match(pattern.regex);
    if (!match) continue;

    const correctionContent = match[1].toLowerCase();

    // 检查纠正内容是否匹配任何 active ProtoStructure
    for (const structure of activeProtoStructures) {
      const structName = (structure.tentative_name ?? '').toLowerCase();
      const structDesc = ((structure as any).description ?? '').toLowerCase();

      // 简单的关键词重叠检测
      const nameTokens = structName.split(/\s+/).filter(t => t.length > 1);
      const descTokens = structDesc.split(/\s+/).filter(t => t.length > 1);
      const allTokens = [...new Set([...nameTokens, ...descTokens])];

      const matchCount = allTokens.filter(t => correctionContent.includes(t)).length;

      if (matchCount >= 2 || correctionContent.includes(structName)) {
        contradictions.push({
          type: 'user_correction',
          detected_at: Date.now(),
          proto_id: (structure as any).proto_id ?? (structure as any).id ?? '',
          evidence: `用户纠正: "${match[1].slice(0, 100)}" → 可能与 "${structName}" 矛盾`,
          severity: pattern.severity,
        });
      }
    }
  }

  return contradictions;
}

// ── before_tool_call hook: 工具模式违反检测 ──

function detectToolPatternViolation(
  toolName: string,
  toolParams: any,
  activeProtoSequences: ProtoStructure[],
  predictionProtocol: PredictionProtocol
): MidSessionContradiction | null {
  // 只检查 ProtoSequence 类型
  const sequences = activeProtoSequences.filter(
    s => (s as any).proto_type === 'sequence'
  );

  for (const seq of sequences) {
    const expectedStep = predictionProtocol.predictNextStep(
      seq as any, /* 当前步骤上下文 */
    );

    if (!expectedStep) continue;

    // 检查调用的工具是否在可能的工具列表中
    const possibleTools = (expectedStep as any).possible_tools ?? [];
    if (possibleTools.length === 0) continue;

    const toolMatched = possibleTools.some((pt: string) =>
      toolName.toLowerCase().includes(pt.toLowerCase()) ||
      pt.toLowerCase().includes(toolName.toLowerCase())
    );

    if (!toolMatched) {
      return {
        type: 'sequence_violation',
        detected_at: Date.now(),
        proto_id: (seq as any).proto_id ?? '',
        evidence: `ProtoSequence "${seq.tentative_name}" 期望步骤 "${expectedStep.label}" ` +
                  `→ 可能工具: [${possibleTools.join(', ')}] ` +
                  `→ 实际调用: ${toolName}`,
        severity: 'minor', // 单次违反 = minor，累计后升级
      };
    }
  }

  return null;
}

// ── 即时置信度调整 ──

function applyImmediateConfidenceAdjustment(
  contradiction: MidSessionContradiction,
  structure: ProtoStructure | CognitiveStructure,
  config: PraxisConfig
): number {
  const cfg = config.midSessionLearning;
  const count = sessionContradictionCount.get(contradiction.proto_id) ?? 0;
  const newCount = count + 1;
  sessionContradictionCount.set(contradiction.proto_id, newCount);

  // 计算本次会话已对该结构施加的即时调整总量
  const sessionAdjustment = sessionContradictions
    .filter(c => c.proto_id === contradiction.proto_id)
    .reduce((sum, c) => {
      if (c.severity === 'critical') return sum + cfg.criticalSeverityImmediatePenalty;
      if (c.severity === 'moderate' && newCount >= cfg.contradictionThreshold)
        return sum + cfg.moderateSeverityImmediatePenalty;
      return sum;
    }, 0);

  // 上限检查
  if (sessionAdjustment >= cfg.maxImmediatePenaltyPerSession) {
    return 0; // 已达上限
  }

  // 计算本次调整
  let adjustment = 0;
  if (contradiction.severity === 'critical') {
    adjustment = cfg.criticalSeverityImmediatePenalty;
  } else if (contradiction.severity === 'moderate' && newCount >= cfg.contradictionThreshold) {
    adjustment = cfg.moderateSeverityImmediatePenalty;
  }
  // minor: adjustment = 0, 仅在 session_end 处理

  // 上限约束
  const remaining = cfg.maxImmediatePenaltyPerSession - sessionAdjustment;
  adjustment = Math.min(adjustment, remaining);

  if (adjustment > 0) {
    structure.confidence = Math.max(0, (structure.confidence ?? 0) - adjustment);
  }

  return adjustment;
}

// ── session_end: 重置会话状态 ──

function resetMidSessionState(): void {
  sessionContradictionCount.clear();
  sessionContradictions.length = 0;
}
```

---

## 五、ProtoTask Phase 1 核心（含 Bootstrap）

```typescript
// analysis/proto-task.ts

interface ProtoTask {
  task_id: string;                    // "prototask_hospital_system_dev"
  task_type: string;                  // "software_project"
  tentative_name: string;             // "医院系统开发模式"
  confidence: number;                 // 0.0 - 1.0
  source: 'llm_general' | 'observation' | 'cumulative';

  typical_phases: {
    name: string;                     // "需求分析"
    typical_duration: string;         // "2-3周"
    key_scenarios: string[];          // ["需求讨论", "需求文档"]
    relevant_structure_ids: string[]; // 该阶段最相关的认知结构 IDs
    common_challenges: string[];      // 该阶段的常见挑战
  }[];

  common_pitfalls: {
    description: string;
    affected_phases: string[];
    mitigation: string;
  }[];

  observations_count: number;
  source_tasks: string[];             // 从哪些已完成任务中归纳
  confidence_trend: {
    after_observation: number;
    confidence: number;
    timestamp: number;
  }[];

  created_at: number;
  last_updated_at: number;
}

// ── Bootstrap: 零样本 ProtoTask 构造 ──

async function bootstrapProtoTask(taskType: string): Promise<ProtoTask> {
  const prompt = `
你是 Praxis 的任务模式分析模块。用户即将开始一个类型为 "${taskType}" 的新任务。

你没有任何已完成同类项目的数据。请基于你的通用知识，为这类任务构建一个初始的、
带低置信度的 ProtoTask 结构。

## 约束

1. **置信度保守**: 所有结论的置信度固定为 0.2。标记来源为 "llm_general_knowledge"。
2. **阶段划分通用**: 只包含这类任务最通用的阶段（不要针对特定行业或团队）。
3. **陷阱不填**: common_pitfalls 留空——团队特定的陷阱只能从实践中学习。
4. **结构不推荐**: relevant_structure_ids 留空——没有观察数据。

## 输出格式

{
  "tentative_name": "这类任务的通用名称",
  "typical_phases": [
    {
      "name": "阶段名",
      "typical_duration": "通常时长",
      "key_scenarios": ["关联场景1", "关联场景2"],
      "relevant_structure_ids": [],
      "common_challenges": []
    }
  ],
  "common_pitfalls": [],
  "confidence": 0.2
}

## 注意
- 阶段数 3-7 个，不要过度细分
- 每个阶段的 key_scenarios 是该阶段最可能涉及的场景类型
- 所有内容基于通用知识，不做具体行业假设
`.trim();

  const result = await callLLM(prompt, {
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    maxTokens: 2000,
    responseFormat: PROTO_TASK_BOOTSTRAP_SCHEMA,
  });

  const parsed = parseProtoTaskBootstrap(result);

  return {
    task_id: `prototask_${taskType}_${Date.now()}`,
    task_type: taskType,
    tentative_name: parsed.tentative_name,
    confidence: 0.2,
    source: 'llm_general',
    typical_phases: parsed.typical_phases,
    common_pitfalls: [],
    observations_count: 0,
    source_tasks: [],
    confidence_trend: [{ after_observation: 0, confidence: 0.2, timestamp: Date.now() }],
    created_at: Date.now(),
    last_updated_at: Date.now(),
  };
}

// ── 累积构造: 从已完成任务中归纳 ──

async function constructProtoTask(
  taskType: string,
  completedTasks: TaskContext[],
  existingProtoTask: ProtoTask | null,
  config: PraxisConfig
): Promise<ProtoTask | null> {
  if (completedTasks.length < config.protoTask.minObservationsForUpdate) return null;

  const existingPhases = existingProtoTask?.typical_phases ?? [];
  const existingPitfalls = existingProtoTask?.common_pitfalls ?? [];

  const prompt = `
你是 Praxis 的任务模式分析模块。以下是 ${completedTasks.length} 个已完成的
"${taskType}" 类型项目的记录。请从中归纳团队特定的任务推进模式。

## 已完成项目记录
${completedTasks.map((t, i) => `
### 项目 ${i + 1}: ${t.task_name}
类型: ${t.task_type ?? '未知'}
阶段演进: ${t.progress_summary}
最终状态: 完成
`).join('\n')}

## 已有的 ProtoTask (如果有)
${existingProtoTask ? `
阶段: ${existingPhases.map(p => p.name).join(' → ')}
陷阱: ${existingPitfalls.map(p => p.description).join('; ') || '无'}
置信度: ${existingProtoTask.confidence.toFixed(2)}
观察次数: ${existingProtoTask.observations_count}
` : '(无 — 首次从真实数据构造)'}

## 请归纳

1. **阶段划分**: 这类项目通常包含哪些阶段？每个阶段的典型时长、关键场景？
   - 如果与已有 ProtoTask 不同 → 合并新旧信息
   - 阶段数: 3-7 个

2. **常见陷阱**: 哪些部分容易出问题？在哪个阶段？如何缓解？
   - 这是团队特有的模式，是 ProtoTask 最有价值的部分

3. **置信度**: 
   - 1 次观察 → 0.3
   - 3 次观察 → 0.5
   - 5 次观察 → 0.65
   - 10 次观察 → 0.8
   - 保守: 实际项目数 < 3 → confidence ≤ 0.5

输出 JSON: ProtoTask 格式
`.trim();

  const result = await callLLM(prompt, {
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    maxTokens: 4000,
    responseFormat: PROTO_TASK_SCHEMA,
  });

  const parsed = parseProtoTaskResult(result);
  const confidence = calculateProtoTaskConfidence(completedTasks.length);

  return {
    task_id: existingProtoTask?.task_id ?? `prototask_${taskType}_${Date.now()}`,
    task_type: taskType,
    tentative_name: parsed.tentative_name ?? existingProtoTask?.tentative_name ?? taskType,
    confidence,
    source: 'observation',
    typical_phases: parsed.typical_phases ?? existingPhases,
    common_pitfalls: parsed.common_pitfalls ?? existingPitfalls,
    observations_count: completedTasks.length,
    source_tasks: completedTasks.map(t => t.task_id),
    confidence_trend: [
      ...(existingProtoTask?.confidence_trend ?? []),
      { after_observation: completedTasks.length, confidence, timestamp: Date.now() },
    ],
    created_at: existingProtoTask?.created_at ?? Date.now(),
    last_updated_at: Date.now(),
  };
}

// ── 置信度成长曲线 ──

function calculateProtoTaskConfidence(observationsCount: number): number {
  // 保守的成长曲线
  if (observationsCount === 0) return 0.2;   // bootstrap
  if (observationsCount === 1) return 0.3;
  if (observationsCount === 2) return 0.4;
  if (observationsCount === 3) return 0.5;
  if (observationsCount === 4) return 0.55;
  if (observationsCount === 5) return 0.65;
  if (observationsCount <= 7) return 0.7;
  if (observationsCount <= 10) return 0.8;
  return Math.min(0.95, 0.8 + (observationsCount - 10) * 0.01);
  // 最高 0.95 — 任何从观察中学到的模式都可能不完整
}
```

---

## 六、用户命令（V11 新增）

```typescript
// /praxis knowledge *
// /praxis task feedback *

async function handleKnowledgeCommand(args: string[], context: SessionContext) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'status':
      // /praxis knowledge status
      const protoTask = await memorySlotGet('proto_task').catch(() => null);
      if (!protoTask) return '没有 ProtoTask 数据。用 /praxis task start 开始一个任务。';

      return `
## ProtoTask: ${protoTask.tentative_name}
- 任务类型: ${protoTask.task_type}
- 置信度: ${protoTask.confidence.toFixed(2)} (${protoTask.observations_count} 次观察)
- 来源: ${protoTask.source}

### 阶段划分
${protoTask.typical_phases.map((p: any, i: number) =>
  `${i + 1}. **${p.name}** (${p.typical_duration})
    - 关键场景: ${p.key_scenarios.join(', ')}
    - 相关结构: ${p.relevant_structure_ids.length} 个
    - 挑战: ${p.common_challenges.join('; ') || '无'}`
).join('\n')}

### 常见陷阱
${protoTask.common_pitfalls.length > 0
  ? protoTask.common_pitfalls.map((p: any) =>
      `- ⚠ ${p.description} (影响: ${p.affected_phases.join(', ')})
         缓解: ${p.mitigation}`
    ).join('\n')
  : '(暂无 — 需要更多项目数据)'}

### 置信度成长
${protoTask.confidence_trend.map((t: any) =>
  `  ${t.after_observation} 次观察 → 置信度 ${t.confidence.toFixed(2)}`
).join('\n')}
`.trim();

    case 'query':
      // /praxis knowledge query --type "proto_task" --task_type "software_project"
      const queryType = args.includes('--type') ? args[args.indexOf('--type') + 1] : 'proto_task';
      const taskType = args.includes('--task_type') ? args[args.indexOf('--task_type') + 1] : undefined;
      const result = await queryKnowledge({
        query_type: queryType as any,
        task_type: taskType,
      });
      return JSON.stringify(result, null, 2);

    default:
      return '用法: /praxis knowledge status | query';
  }
}

async function handleTaskFeedbackCommand(args: string[], context: SessionContext) {
  // /praxis task feedback --subtask "预约挂号 API" --outcome "partial_success"
  //   --note "功能正确但响应时间不达标"
  const subtaskName = args.includes('--subtask') ? args[args.indexOf('--subtask') + 1] : null;
  const outcome = args.includes('--outcome') ? args[args.indexOf('--outcome') + 1] : null;
  const note = args.includes('--note') ? args[args.indexOf('--note') + 1] : null;

  if (!subtaskName || !outcome) {
    return '用法: /praxis task feedback --subtask "名称" --outcome "success|partial_success|failure|abandoned" [--note "备注"]';
  }

  const validOutcomes = ['success', 'partial_success', 'failure', 'abandoned'];
  if (!validOutcomes.includes(outcome)) {
    return `无效的 outcome: ${outcome}。有效值: ${validOutcomes.join(', ')}`;
  }

  const taskContext = await loadTaskContext();
  const subtaskOutcome: SubtaskOutcome = {
    subtask_id: `subtask_${Date.now()}`,
    subtask_name: subtaskName,
    outcome: outcome as any,
    proto_structures_used: [], // 手动反馈时无法自动关联
    task_id: taskContext?.task_id ?? 'unknown',
    completion_criteria_met: outcome === 'success' ? ['用户确认完成'] : [],
    completion_criteria_missed: outcome !== 'success' ? ['用户反馈问题'] : [],
    user_feedback: note ?? undefined,
    rework_needed: outcome === 'partial_success' || outcome === 'failure',
    started_at: Date.now() - 3600000, // 估算 1 小时前开始
    completed_at: Date.now(),
    actual_duration_minutes: 60, // 估算
  };

  await memorySave('task_outcomes', subtaskOutcome);
  return `已记录子任务 "${subtaskName}" 的反馈 (${outcome})。Praxis 将在下次分析中调整相关认知结构的置信度。`;
}
```

---

## 兄弟文件

- [What is Praxis V11?](what-is.md) — V11 的工程定义
- [Why Praxis V11?](why.md) — 第一性原理：为什么需要知行合一闭环
- [Who is it for?](who.md) — 三角色职责变化
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V10 基础 + 5 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
