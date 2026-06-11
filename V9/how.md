# How does AgentOS V9 work?

> V9 的核心工程实现：上下文压力监测与四级压缩、按需结构检索、注意力遥测、角色/概念验证器、工具映射增强、自适应配置、一致性引擎。

---

## 一、上下文压力监测器

```typescript
// orchestration/context-pressure-monitor.ts

enum PressureLevel {
  Normal   = 'normal',    // < 60% — 全量注入
  Elevated = 'elevated',  // 60-75% — 压缩注入
  High     = 'high',      // 75-90% — 最小注入
  Critical = 'critical',  // > 90% — 索引 + 按需检索
}

interface ContextPressure {
  level: PressureLevel;
  usageRatio: number;          // 0.0 - 1.0
  totalEstimated: number;      // 估算的总 token 消耗
  availableTokens: number;     // 剩余可用
  agentOSBudget: number;       // 分配给 AgentOS 注入的预算
  breakdown: {
    systemAndTools: number;
    conversationHistory: number;
    userData: number;
    agentOSPrevious: number;   // 上次 AgentOS 注入的 token 数
    outputBuffer: number;      // LLM 输出预留
  };
}

function measureContextPressure(
  sessionContext: SessionContext,
  config: AgentOSConfig
): ContextPressure {

  // 1. 估算各部分 (基于字符数, < 1ms)
  const systemAndTools = estimateSystemAndTools(sessionContext);
  const conversationHistory = estimateConversationTokens(sessionContext);
  const userData = estimateUserData(sessionContext);
  const agentOSPrevious = sessionContext.lastAgentOSInjectionTokens ?? 0;

  // LLM 输出缓冲: 窗口的 10%, 最少 50K
  const outputBuffer = Math.max(50000, Math.floor(config.contextWindow * 0.1));

  const totalUsed = systemAndTools + conversationHistory + userData
                  + agentOSPrevious + outputBuffer;
  const usageRatio = totalUsed / config.contextWindow;
  const available = config.contextWindow - totalUsed;

  // 2. 压力等级判定
  let level: PressureLevel;
  const t = config.contextPressure.levels;
  if (usageRatio < t.normalThreshold)        level = PressureLevel.Normal;
  else if (usageRatio < t.elevatedThreshold)  level = PressureLevel.Elevated;
  else if (usageRatio < t.highThreshold)      level = PressureLevel.High;
  else                                        level = PressureLevel.Critical;

  // 3. AgentOS 注入预算 (最多占可用空间的 30%)
  const maxShare = Math.floor(available * 0.3);
  const agentOSBudget = calculateBudget(level, maxShare);

  return {
    level, usageRatio, totalEstimated: totalUsed,
    availableTokens: available, agentOSBudget,
    breakdown: { systemAndTools, conversationHistory,
                 userData, agentOSPrevious, outputBuffer },
  };
}

function calculateBudget(level: PressureLevel, maxShare: number): number {
  switch (level) {
    case PressureLevel.Normal:   return Math.min(maxShare, 80000);
    case PressureLevel.Elevated: return Math.min(maxShare, 15000);
    case PressureLevel.High:     return Math.min(maxShare, 5000);
    case PressureLevel.Critical: return Math.min(maxShare, 1000);
  }
}

// 快速 token 估算 (基于字符数, 精度 ±15%)
function estimateTokens(text: string): number {
  // 英文: ~4 chars/token, 中文: ~1.5 chars/token
  const latinChars = (text.match(/[a-zA-Z0-9\s]/g) || []).length;
  const cjkChars = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  const other = text.length - latinChars - cjkChars;
  return Math.ceil(latinChars / 4 + cjkChars / 1.5 + other / 3);
}
```

---

## 二、四级压缩注入

```typescript
// orchestration/context-organizer.ts (V9 增强)

function organizeContextAdaptive(
  sceneRecognition: SceneRecognitionResult,
  protoStructures: ProtoStructure[],
  cognitiveStructures: CognitiveStructure[],
  pendingQuestions: Question[],
  pressure: ContextPressure,
  config: AgentOSConfig
): { injection: string; registeredTool?: Tool } {

  switch (pressure.level) {
    case PressureLevel.Normal:
      return { injection: organizeNormal(sceneRecognition, protoStructures,
                      cognitiveStructures, pendingQuestions, config) };

    case PressureLevel.Elevated:
      return { injection: organizeElevated(sceneRecognition, protoStructures,
                      cognitiveStructures, pendingQuestions, config) };

    case PressureLevel.High:
      return { injection: organizeHigh(sceneRecognition, protoStructures,
                      cognitiveStructures, pendingQuestions, config) };

    case PressureLevel.Critical:
      return {
        injection: organizeCritical(sceneRecognition, protoStructures,
                      cognitiveStructures, pendingQuestions, config),
        registeredTool: buildRecallStructureTool(protoStructures, cognitiveStructures),
      };
  }
}

// ── Normal: 全量注入 (~30K tokens) ──
function organizeNormal(...): string { /* 同 V8 的 organizeContext */ }

// ── Elevated: 压缩注入 (~16K tokens) ──
function organizeElevated(
  sceneRec: SceneRecognitionResult,
  protos: ProtoStructure[],
  structs: CognitiveStructure[],
  questions: Question[],
  config: AgentOSConfig
): string {

  const layer1 = buildMinimalSceneIndex(sceneRec);  // ~300 tokens

  // Tier A: 当前场景 — 完整详情 (保留)
  const tierA = buildTierAFull(sceneRec, protos, structs);

  // Tier B: 相近场景 — 仅名称+一句话 (压缩)
  const tierB = buildTierBOneLine(sceneRec, protos, structs);

  // Tier C: 移除
  const tierC = '';

  const layer3 = buildMinimalActivation(questions);  // ~200 tokens
  return [layer1, tierA, tierB, tierC, layer3].filter(Boolean).join('\n\n---\n\n');
}

// ── High: 最小注入 (~3.5K tokens) ──
function organizeHigh(
  sceneRec: SceneRecognitionResult,
  protos: ProtoStructure[],
  structs: CognitiveStructure[],
  questions: Question[],
  config: AgentOSConfig
): string {

  const layer1 = buildMinimalSceneIndex(sceneRec);  // ~200 tokens

  // Tier A: 当前场景 — 摘要而非完整详情
  const currentStructures = [
    ...structs.filter(cs => cs.applies_to.includes(sceneRec.scenario_id)),
    ...protos.filter(p => p.scenario_id === sceneRec.scenario_id),
  ];
  currentStructures.sort((a, b) =>
    ((b.confidence ?? 0) * (b.observations_count ?? 1)) -
    ((a.confidence ?? 0) * (a.observations_count ?? 1))
  );

  const tierA = currentStructures.map(s => {
    const name = s.tentative_name ?? (s as any).name ?? 'unnamed';
    const conf = (s.confidence ?? 0).toFixed(2);

    // 序列化摘要: 仅名称 + 置信度 + 关键步骤
    if ((s as any).proto_type === 'sequence' || (s as any).sequence_steps) {
      const steps = ((s as any).sequence_steps ?? [])
        .map((st: any) => st.tentative_label).join(' → ');
      return `## ${name} [sequence, ${conf}]\n${steps}`;
    }
    // 角色: 名称 + 一句话职责
    if ((s as any).proto_type === 'role') {
      const behaviors = ((s as any).role_behaviors ?? [])
        .map((b: any) => b.behavior).slice(0, 3).join(', ');
      return `## ${name} [role, ${conf}]\n职责: ${behaviors}`;
    }
    // 概念/目的: 仅名称 + 置信度
    return `## ${name} [${(s as any).proto_type ?? 'structure'}, ${conf}]`;
  }).join('\n\n');

  // Tier B/C: 移除
  const layer3 = buildMinimalActivation(questions);
  return [layer1, tierA, layer3].filter(Boolean).join('\n\n---\n\n');
}

// ── Critical: 索引 + 按需检索 (~1K tokens) ──
function organizeCritical(
  sceneRec: SceneRecognitionResult,
  protos: ProtoStructure[],
  structs: CognitiveStructure[],
  questions: Question[],
  config: AgentOSConfig
): string {

  const currentName = sceneRec.scenario_id;

  // Top 5 结构摘要 (当前场景 + 全局最可靠的)
  const allStructures = [
    ...structs.filter(cs => cs.applies_to.includes(sceneRec.scenario_id)),
    ...protos.filter(p => p.scenario_id === sceneRec.scenario_id),
  ];
  allStructures.sort((a, b) =>
    ((b.confidence ?? 0) * (b.observations_count ?? 1)) -
    ((a.confidence ?? 0) * (a.observations_count ?? 1))
  );

  const topStructures = allStructures.slice(0, 5).map(s => {
    const name = s.tentative_name ?? (s as any).name ?? 'unnamed';
    const conf = (s.confidence ?? 0).toFixed(2);
    const type = (s as any).proto_type ?? 'structure';
    return `- ${name} [${type}, ${conf}]`;
  }).join('\n');

  return `
# AgentOS — 精简模式

当前场景: ${currentName}
上下文使用率: Critical (可用空间 < 10%)

## 已知结构索引 (共 ${protos.length + structs.length} 个)
${topStructures}

## 关键指令
1. 上下文空间即将用尽。请精简回复，优先完成核心任务。
2. 当你需要某个认知结构的完整详情时，调用 \`recall_structure\` 工具。
   例如: \`recall_structure(query="门诊流程", structure_type="sequence")\`
3. 上述结构的置信度不等——使用时关注置信度标记。
4. 如果实际与上述模式不符，使用 [PREDICTION_FAILED: ...] 标记。

## 待验证
${questions.length > 0 ? questions.slice(0, 2).map(q => `- ${q.question}`).join('\n') : '(无)'}
`.trim();
}
```

---

## 三、按需结构检索 (Lazy Loading)

```typescript
// memory/recall-structure.ts

const recallStructureToolDef: ToolDefinition = {
  name: 'recall_structure',
  description: `按名称或关键词检索 AgentOS 认知结构的完整详情。
在上下文空间紧张时，结构不会预先注入——你需要主动调用此工具来获取。
调用时机: 当你需要某个结构的完整步骤/角色行为/概念特征来完成任务时。`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '结构名称、部分名称、或场景名称。如 "门诊流程"、"挂号"、"医院"。'
      },
      structure_type: {
        type: 'string',
        enum: ['sequence', 'role', 'concept', 'purpose', 'any'],
        description: '筛选结构类型。默认 any。'
      },
      max_results: {
        type: 'integer',
        default: 3,
      }
    },
    required: ['query']
  }
};

async function handleRecallStructure(
  args: { query: string; structure_type?: string; max_results?: number },
  protoStructures: ProtoStructure[],
  cognitiveStructures: CognitiveStructure[]
): Promise<string> {

  const query = args.query.toLowerCase();
  const typeFilter = args.structure_type ?? 'any';
  const maxResults = args.max_results ?? 3;

  // 全量搜索 (结构已在内存中)
  const allStructures = [
    ...protoStructures.map(p => ({ ...p, _kind: 'proto' })),
    ...cognitiveStructures.map(cs => ({ ...cs, _kind: 'crystallized' })),
  ];

  const candidates = allStructures
    .filter(s => {
      if (typeFilter === 'any') return true;
      return (s as any).proto_type === typeFilter ||
             (s as any).structure_type === typeFilter;
    })
    .map(s => {
      const name = (s.tentative_name ?? (s as any).name ?? '').toLowerCase();
      const scenario = ((s as any).scenario_id ?? '').toLowerCase();

      // 关键字匹配: 名称包含 query 或 scenario 包含 query
      let score = 0;
      if (name.includes(query)) score += 10;
      if (scenario.includes(query)) score += 5;

      // 分词匹配
      const queryTokens = query.split(/\s+/);
      for (const token of queryTokens) {
        if (name.includes(token)) score += 3;
        if (scenario.includes(token)) score += 2;
      }

      // 置信度加权
      score += (s.confidence ?? 0) * 2;

      return { structure: s, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (candidates.length === 0) {
    return `未找到匹配 "${args.query}" 的认知结构。
可用的结构类型: ${getAvailableStructureSummary(protoStructures, cognitiveStructures)}`;
  }

  return candidates.map(c => {
    const s = c.structure;
    const name = s.tentative_name ?? (s as any).name ?? 'unnamed';
    const conf = (s.confidence ?? 0).toFixed(2);
    const calib = getConfidenceCalibrationNote(s);

    return `${calib}\n${serializeStructureFull(s)}`;
  }).join('\n\n---\n\n');
}
```

---

## 四、注意力遥测

```typescript
// analysis/attention-telemetry.ts

interface StructureUsageRecord {
  proto_id: string;
  session_id: string;
  used: boolean;            // LLM 是否标记了 [STRUCTURE_USED]
  manually_invoked: boolean; // 是否通过 recall_structure 主动拉取
  timestamp: number;
}

interface UsageStats {
  proto_id: string;
  total_sessions: number;       // 被注入的总会话数
  sessions_used: number;        // 被实际使用的会话数
  adoption_rate: number;        // 采用率 (used / total)
  manually_recalled: number;    // 主动拉取次数
  is_zombie: boolean;           // 采用率 < zombie_threshold
  confidence: number;           // 当前置信度
  confidence_usage_gap: number; // 置信度 - 采用率 (越大越可疑)
}

function parseStructureUsageMarkers(
  agentOutput: string
): string[] {
  // 解析 [STRUCTURE_USED: ps_hospital_outpatient_flow]
  const pattern = /\[STRUCTURE_USED:\s*([^\]]+)\]/g;
  return Array.from(agentOutput.matchAll(pattern), m => m[1].trim());
}

function computeUsageStats(
  structureId: string,
  usageHistory: StructureUsageRecord[],
  config: AgentOSConfig
): UsageStats {

  const recent = usageHistory.slice(-20);  // 最近 20 次会话
  const total = recent.length;
  const used = recent.filter(r => r.used).length;
  const adoptionRate = total > 0 ? used / total : 0;

  return {
    proto_id: structureId,
    total_sessions: total,
    sessions_used: used,
    adoption_rate: adoptionRate,
    manually_recalled: recent.filter(r => r.manually_invoked).length,
    is_zombie: adoptionRate < config.attentionTelemetry.zombieThreshold,
    confidence: 0,  // 由调用者填充
    confidence_usage_gap: 0,  // 由调用者填充
  };
}

// 系统提示中给 LLM 的指令:
// "当你确实使用了上述某个认知结构来指导你的操作时，
//  在你的推理中标记 [STRUCTURE_USED: <proto_id>]。
//  不要每次回复都标记——只在确实参考了结构时使用。"
```

---

## 五、ProtoRole 验证器

```typescript
// analysis/role-verifier.ts

interface RoleVerificationResult {
  role_proto_id: string;
  match_rate: number;           // 角色的行为中有多少被实际观察到
  behaviors_observed: string[]; // 被实际观察到的行为
  behaviors_missing: string[];  // 未被观察到的行为
  behaviors_by_other_roles: {   // 被其他角色执行的行为
    behavior: string;
    executed_by: string;        // 实际执行者的标识
  }[];
  confidence_impact: number;
  is_conclusive: boolean;
}

function verifyProtoRole(
  protoRole: ProtoStructure,    // proto_type = 'role'
  toolCallerMap: Map<string, string[]>,  // tool → caller 标识
  otherRolesInScenario: ProtoStructure[],
  config: AgentOSConfig
): RoleVerificationResult {

  const expectedBehaviors = protoRole.role_behaviors ?? [];
  const observed: string[] = [];
  const missing: string[] = [];
  const byOtherRoles: RoleVerificationResult['behaviors_by_other_roles'] = [];

  for (const behavior of expectedBehaviors) {
    // 搜索该行为对应的工具调用
    const matchingTool = findMatchingToolCall(behavior.behavior, toolCallerMap);

    if (matchingTool) {
      observed.push(behavior.behavior);

      // 检查: 这个工具调用的执行者是否与当前角色一致?
      // (caller 信息来自 after_tool_call 的上下文)
      // 如果该行为也被其他 ProtoRole 声称 → 角色边界模糊
      const otherClaimer = otherRolesInScenario.find(r =>
        r.role_behaviors?.some(b =>
          fuzzyMatch(b.behavior, behavior.behavior)));
      if (otherClaimer) {
        byOtherRoles.push({
          behavior: behavior.behavior,
          executed_by: otherClaimer.tentative_name,
        });
      }
    } else {
      missing.push(behavior.behavior);
    }
  }

  const matchRate = expectedBehaviors.length > 0
    ? observed.length / expectedBehaviors.length
    : 0;

  // 置信度影响: 缺失 → 负面信号; 被其他角色执行 → 边界不清
  const impact = matchRate < 0.5 ? -0.1 : matchRate > 0.8 ? 0.03 : 0;

  return {
    role_proto_id: protoRole.proto_id,
    match_rate: matchRate,
    behaviors_observed: observed,
    behaviors_missing: missing,
    behaviors_by_other_roles: byOtherRoles,
    confidence_impact: impact,
    is_conclusive: expectedBehaviors.length >= 3,
  };
}
```

---

## 六、ProtoConcept 对抗性验证

```typescript
// analysis/concept-verifier.ts

async function verifyProtoConcept(
  protoConcept: ProtoStructure,    // proto_type = 'concept'
  supportingElements: SalientElement[],
  config: AgentOSConfig
): Promise<ConceptVerificationResult> {

  // 对抗性 prompt: 尝试反驳这个概念
  const prompt = `
你是一个认知验证器。你的任务是尝试找出以下概念中的问题。

## 待验证概念
名称: ${protoConcept.tentative_name}
置信度: ${protoConcept.confidence.toFixed(2)}
特征: ${protoConcept.concept_features?.map(f => f.feature).join(', ')}

## 支持证据 (从实际对话中提取)
${supportingElements.map(e => `- ${e.raw_observation}`).join('\n')}

## 你的任务
请尝试找出以下问题:
1. 这个概念的特征中，哪些可能只是偶然相关而非定义性特征？
2. 有哪些边界案例可能被这个概念遗漏？
3. 这个概念是否可能与其他已知概念重叠？（如果有，指出重叠点）
4. 给出你的总体判断: 这个概念是否可靠？

输出格式: JSON
{
  "weak_features": ["可能不成立的特征"],
  "missing_edge_cases": ["被遗漏的边界案例"],
  "overlap_concerns": ["可能的概念重叠"],
  "verdict": "reliable" | "needs_revision" | "unreliable",
  "confidence_adjustment": -0.2 ~ +0.05
}
`.trim();

  const result = await callLLM(prompt, {
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    maxTokens: 2000,
  });

  return parseConceptVerification(result, protoConcept.proto_id);
}
```

---

## 七、一致性检查器

```typescript
// analysis/consistency-checker.ts

async function checkConsistency(
  scenarioId: string,
  protoStructures: ProtoStructure[],
  config: AgentOSConfig
): Promise<ConsistencyReport> {

  // 仅检查同一场景且有 > 1 个结构的场景
  const scenarioProtos = protoStructures.filter(p => p.scenario_id === scenarioId);
  if (scenarioProtos.length < 2) {
    return { scenario_id: scenarioId, contradictions: [], is_consistent: true };
  }

  const prompt = `
以下是同一场景(${scenarioId})的多个认知结构。
请检查它们之间是否存在逻辑矛盾。

${scenarioProtos.map(p => `
### ${p.tentative_name} [${p.proto_type}]
${summarizeProtoForConsistency(p)}
`).join('\n')}

## 检查维度
1. 两个 ProtoSequence 是否描述了矛盾的流程？
2. ProtoRole 的行为是否与 ProtoSequence 的步骤一致？
3. ProtoPurpose 是否与 ProtoSequence 的最后步骤矛盾？

输出 JSON: {
  "contradictions": [
    {"structure_a": "id", "structure_b": "id",
     "contradiction": "描述", "severity": "high|medium|low"}
  ],
  "recommended_actions": ["建议"]
}
`.trim();

  const result = await callLLM(prompt, {
    model: 'claude-sonnet-4-6',
    temperature: 0.2,
    maxTokens: 2000,
  });

  const report = parseConsistencyReport(result, scenarioId);

  // 矛盾 → 降低双方置信度
  for (const c of report.contradictions) {
    if (c.severity === 'high') {
      applyContradictionPenalty(c.structure_a, c.structure_b, 0.15);
    }
  }

  return report;
}
```

---

## 八、自适应配置

```typescript
// analysis/config-adapter.ts

async function adaptConfig(
  config: AgentOSConfig,
  telemetry: AgentOSTelemetry,
  recentSessions: SessionTrace[]
): Promise<ConfigAdjustment[]> {

  const adjustments: ConfigAdjustment[] = [];

  // 1. 固化阈值自适应
  // 如果运维者经常驳回固化提案 → 阈值太低 → 自动提高
  const recentProposals = recentSessions.flatMap(s => s.crystallization_proposals ?? []);
  const rejected = recentProposals.filter(p => p.status === 'rejected');
  if (rejected.length >= 3 && recentProposals.length >= 10) {
    const rejectionRate = rejected.length / recentProposals.length;
    if (rejectionRate > 0.3) {
      // 提高阈值 10% (不超过 +20% 范围)
      const newThreshold = Math.min(
        config.crystallizationThresholds.min_confidence * 1.1,
        config.crystallizationThresholds.min_confidence * (1 + config.adaptiveConfig.adjustmentRange)
      );
      if (!config.adaptiveConfig.lockedParams.includes('crystallization.min_confidence')) {
        adjustments.push({
          param: 'crystallization.min_confidence',
          old_value: config.crystallizationThresholds.min_confidence,
          new_value: newThreshold,
          reason: `固化提案驳回率 ${(rejectionRate*100).toFixed(0)}% > 30%`,
        });
      }
    }
  }

  // 2. 退化阈值自适应
  // 如果退化检测的误报率高 (标记退化但用户手动恢复) → 阈值太低
  const degraded = recentSessions.flatMap(s => s.degradation_events ?? []);
  const restored = degraded.filter(d => d.status === 'restored_by_user');
  if (restored.length >= 3) {
    const falseAlarmRate = restored.length / Math.max(degraded.length, 1);
    if (falseAlarmRate > 0.2) {
      const newThreshold = Math.min(
        config.degradationThresholds.manual_approved.max_accuracy_drop * 0.95,
        config.degradationThresholds.manual_approved.max_accuracy_drop
      );
      if (!config.adaptiveConfig.lockedParams.includes('degradation.max_accuracy_drop')) {
        adjustments.push({
          param: 'degradation.max_accuracy_drop',
          old_value: config.degradationThresholds.manual_approved.max_accuracy_drop,
          new_value: newThreshold,
          reason: `退化误报率 ${(falseAlarmRate*100).toFixed(0)}% > 20%`,
        });
      }
    }
  }

  // 3. 自动固化阈值自适应
  // ... (类似逻辑: 基于 auto_crystallize 被回滚的比例)

  return adjustments;
}
```

---

## 兄弟文件

- [What is AgentOS V9?](what-is.md) — V9 的工程定义
- [Why AgentOS V9?](why.md) — 第一性原理：为什么 token 爆炸需要压力感知
- [Who is it for?](who.md) — 三角色职责变化
- [When does it operate?](when.md) — 4 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V8 基础 + 7 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
