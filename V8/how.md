# How does AgentOS V8 work?

> V8 的核心工程实现：层级化上下文组织、统计验证器、双信号置信度融合、累积 transcript 分析、自动固化阶梯。

---

## 一、核心编排逻辑

### 1.1 插件入口

```typescript
export default function agentosPlugin(config: AgentOSConfig): OpenClawPlugin {
  return {
    name: 'agentos',
    version: '8.0.0',

    hooks: {
      session_start:    createSessionStartHandler(config),
      message_received: createMessageReceivedHandler(config),
      before_tool_call: createBeforeToolCallHandler(config),
      after_tool_call:  createAfterToolCallHandler(config),
      agent_end:        createAgentEndHandler(config),
      session_end:      createSessionEndHandler(config),
    },

    crons: [
      { schedule: '0 3 * * 0', handler: degradationDeepCheckCron },
      { schedule: '0 4 1 * *', handler: architectureAuditCron },
      { schedule: '0 5 * * 0', handler: structureLifecycleCron },
    ],
  };
}
```

### 1.2 场景识别器（从 scene-matcher 保留的认知基础操作）

```typescript
// orchestration/scene-recognizer.ts

interface SceneRecognitionResult {
  scenario_id: string;              // 识别到的场景 ID（zero_prior 场景为新生成的 ID）
  recognition_confidence: number;   // 0.0 - 1.0, 对场景识别的确信度
  is_new_scenario: boolean;         // 是否识别为全新场景
  matched_scenarios: {              // 所有已知场景的适配度（用于 session_end 场景聚类）
    scenario_id: string;
    adaptation_score: number;
    reason: string;                 // "关键词匹配: 医院, 门诊, 挂号"
  }[];
}

function recognizeScene(
  messages: Message[],
  knownScenarios: ScenarioProfile[],
  config: AgentOSConfig
): SceneRecognitionResult {

  // Step 1: 提取场景特征
  const features = extractSceneFeatures(messages);
  // features = { keywords, entities, intents, domain_hints }

  // Step 2: 与已知场景计算适配度
  const matches = knownScenarios.map(scenario => ({
    scenario_id: scenario.id,
    adaptation_score: calculateAdaptationScore(features, scenario.profile),
    reason: buildMatchReason(features, scenario.profile),
  }));

  matches.sort((a, b) => b.adaptation_score - a.adaptation_score);

  // Step 3: 判断场景归属
  const bestMatch = matches[0];
  const isNewScenario = bestMatch.adaptation_score < 0.2;  // 所有已知场景都不匹配

  return {
    scenario_id: isNewScenario
      ? generateNewScenarioId(features)
      : bestMatch.scenario_id,
    recognition_confidence: isNewScenario ? 0.3 : bestMatch.adaptation_score,
    is_new_scenario: isNewScenario,
    matched_scenarios: matches.slice(0, 5),  // Top 5
  };
}

function calculateAdaptationScore(
  features: SceneFeatures,
  profile: ScenarioProfile
): number {
  // 与 V7 相同的适配度计算逻辑，但阈值更宽松
  // 因为场景识别不再用于"选择注入"——它只用于"标记场景"和"transcript 分组"
  return weightedSum(
    keywordMatch(features.keywords, profile.keywords) * 0.3 +
    entitySimilarity(features.entities, profile.entities) * 0.3 +
    intentMatch(features.intents, profile.intents) * 0.2 +
    userMarkedScenarioMatch(features, profile) * 0.2
  );
}
```

### 1.3 上下文组织器（增强版：相关性预排序 + 置信度校准）

```typescript
// orchestration/context-organizer.ts

interface OrganizedContext {
  layer1_index: string;
  layer2_tierA: string;        // 当前场景 — 完整详情 + 置信度校准
  layer2_tierB: string;        // 相近场景 — 摘要+引用
  layer2_tierC: string;        // 不相关场景 — 仅名称+一句话
  layer3_activation: string;
  totalTokens: number;
}

function organizeContext(
  sceneRecognition: SceneRecognitionResult,
  protoStructures: ProtoStructure[],
  cognitiveStructures: CognitiveStructure[],
  pendingQuestions: Question[],
  config: AgentOSConfig
): OrganizedContext {

  // ── Layer 1: 场景索引 ──
  const allScenarios = groupByScenario(protoStructures, cognitiveStructures);
  const scenarioSummaries = allScenarios.map(s =>
    `- ${s.scenarioId}: ${s.summary} (原型: ${s.activeProtoCount}, 固化: ${s.crystallizedCount})`
  ).join('\n');

  const currentProtosSummary = protoStructures
    .filter(p => p.scenario_id === sceneRecognition.scenario_id)
    .map(p => `  - ${p.tentative_name} [${p.proto_type}] 置信度: ${p.confidence.toFixed(2)} (${p.observations_count}次)`)
    .join('\n');

  const recognitionNote = sceneRecognition.is_new_scenario
    ? '⚠️ 零先验场景 — 尚未形成任何认知结构'
    : `匹配置信度: ${sceneRecognition.recognition_confidence.toFixed(2)}`;

  const layer1_index = `
# AgentOS 认知状态

## 已知场景
${scenarioSummaries}

## 当前场景: ${sceneRecognition.scenario_id}
${recognitionNote}
${currentProtosSummary || '  (零先验)'}

## 架构版本: ${config.architectureVersion}
`.trim();

  // ── Layer 2: 按相关性分三层 ──

  // Tier A: 当前场景的结构（最前面，完整详情 + 置信度校准指令）
  const currentStructures = [
    ...cognitiveStructures.filter(cs =>
      cs.applies_to.includes(sceneRecognition.scenario_id)),
    ...protoStructures.filter(p =>
      p.scenario_id === sceneRecognition.scenario_id),
  ];

  currentStructures.sort((a, b) => {
    const scoreA = (a.confidence ?? 0) * (a.observations_count ?? 1);
    const scoreB = (b.confidence ?? 0) * (b.observations_count ?? 1);
    return scoreB - scoreA;
  });

  const tierA = currentStructures.map(s => {
    const calibration = getConfidenceCalibration(s);
    return `${calibration}\n${serializeStructureFull(s)}`;
  }).join('\n\n---\n\n');

  // Tier B: 相近场景的结构（中间，摘要 + 关键引用 + 校准信号）
  const relatedScenarios = sceneRecognition.matched_scenarios
    .filter(m => m.adaptation_score > 0.15 && m.scenario_id !== sceneRecognition.scenario_id)
    .slice(0, 5);

  const relatedStructures = relatedScenarios.flatMap(rs => {
    const protos = protoStructures.filter(p => p.scenario_id === rs.scenario_id);
    const structs = cognitiveStructures.filter(cs => cs.applies_to.includes(rs.scenario_id));
    return [...protos, ...structs].slice(0, 3);  // 每个相关场景最多 3 个结构
  });

  const tierB = relatedStructures.length > 0
    ? `## 相关场景参考 (以下模式来自类似但不完全相同的场景，可能有关联，但不要直接套用)\n\n`
      + relatedStructures.map(s => {
          const scenarioName = s.scenario_id ?? 'unknown';
          return `### 来自场景 [${scenarioName}]: ${s.tentative_name ?? s.name}\n`
               + `${serializeStructureSummary(s)}\n`
               + `⚠️ 注意: 此结构来自不同场景，仅供参考和类比。`;
        }).join('\n\n')
    : '';

  // Tier C: 不相关场景（最后，仅名称 + 一句话描述，防止 LLM 完全不知道它们存在）
  const unrelatedStructures = [
    ...protoStructures.filter(p =>
      !currentStructures.includes(p) && !relatedStructures.includes(p)),
    ...cognitiveStructures.filter(cs =>
      !currentStructures.includes(cs) && !relatedStructures.includes(cs)),
  ];

  const tierC = unrelatedStructures.length > 0
    ? `## 其他已知结构 (以下结构与当前场景基本无关，仅供参考)\n\n`
      + unrelatedStructures.map(s =>
          `- ${s.tentative_name ?? s.name}: ${getOneLineSummary(s)}`
        ).join('\n')
    : '';

  // ── Layer 3: 激活指令 ──
  const layer3_activation = `
## 待验证问题
${pendingQuestions.length > 0
  ? pendingQuestions.map(q => `- ${q.question} (优先级: ${q.priority})`).join('\n')
  : '(无)'}

## 预测标记协议
当你的操作与上述认知结构不一致时，使用:
  [PREDICTION_FAILED: 简短描述不符之处]
当你不确定预测是否正确时:
  [PREDICTION_UNCERTAIN: 简短描述]
`.trim();

  return {
    layer1_index,
    layer2_tierA: tierA,
    layer2_tierB: tierB,
    layer2_tierC: tierC,
    layer3_activation,
    totalTokens: estimateTokens(layer1_index + tierA + tierB + tierC + layer3_activation),
  };
}

// ── 置信度校准指令 ──
function getConfidenceCalibration(structure: ProtoStructure | CognitiveStructure): string {
  const conf = structure.confidence ?? 0;
  const obs = structure.observations_count ?? 0;

  if (conf >= 0.8 && obs >= 5) {
    return `## 确定结构: ${structure.tentative_name ?? structure.name} (置信度 ${conf.toFixed(2)}, ${obs}次观察)\n`
         + `以下是你的确定理解。请基于这些结构执行任务。`;
  } else if (conf >= 0.4) {
    return `## 参考模式: ${structure.tentative_name ?? structure.name} (置信度 ${conf.toFixed(2)}, ${obs}次观察)\n`
         + `以下是观察到的模式，可能不完整。请参考但保持警惕，主动验证。`;
  } else {
    return `## 试探假设: ${structure.tentative_name ?? structure.name} (置信度 ${conf.toFixed(2)}, 仅${obs}次观察)\n`
         + `以下是初步假设，很可能是错的或严重不完整。请主动验证而非盲从。`;
  }
}

function serializeStructureFull(structure: ProtoStructure | CognitiveStructure): string {
  // 序列化完整结构详情（ProtoStructure 所有维度 / CognitiveStructure 所有字段）
  // ... 同 V7 的序列化逻辑
}

function serializeStructureSummary(structure: ProtoStructure | CognitiveStructure): string {
  // 序列化结构摘要（名称 + 一句话描述 + 关键维度的简要信息）
  // 对于 ProtoSequence: 仅输出步骤列表
  // 对于 ProtoRole: 仅输出角色名 + 关键行为
  // ... token 控制在 200 tokens/结构
}

function getOneLineSummary(structure: ProtoStructure | CognitiveStructure): string {
  // 一句话摘要，< 50 tokens
  const type = (structure as any).proto_type ?? 'structure';
  const name = structure.tentative_name ?? (structure as any).name ?? 'unnamed';
  return `[${type}] ${name}`;
}
```

---

## 二、统计验证器（打破 LLM 自引用闭环）

这是 V8 最重要的新增模块。它提供一个**完全独立于 LLM 自我报告**的验证信号。

```typescript
// analysis/statistical-verifier.ts

interface StatisticalVerificationResult {
  proto_id: string;
  match_rate: number;             // 0.0 - 1.0, 匹配的步骤比例
  matched_steps: string[];        // 匹配成功的步骤 label
  misaligned_steps: {             // 位置错位的步骤
    predicted_position: number;
    predicted_label: string;
    found_at_position: number | null;  // null = 完全未找到
  }[];
  missing_steps: string[];        // 在工具序列中完全找不到的步骤
  extra_steps: string[];          // 工具序列中有但 ProtoSequence 未预测的步骤
  confidence_impact: number;      // -0.2 ~ +0.1, 建议的置信度调整
  is_conclusive: boolean;         // 信号是否足够强（工具序列是否足够反映业务步骤）
}

function verifyProtoSequence(
  protoSequence: ProtoStructure,   // proto_type = 'sequence'
  toolTrace: ToolTraceEntry[],
  config: AgentOSConfig
): StatisticalVerificationResult {

  const steps = protoSequence.sequence_steps ?? [];
  if (steps.length === 0) {
    return { match_rate: 0, matched_steps: [], misaligned_steps: [],
             missing_steps: [], extra_steps: [], confidence_impact: 0,
             is_conclusive: false };
  }

  // Step 1: 对每个 ProtoSequence 步骤，在工具调用序列中搜索最佳匹配
  const toolDescriptions = toolTrace.map(t =>
    `${t.tool} ${t.params_summary} ${t.result_summary}`
  );

  const matched: Set<number> = new Set();  // 已匹配的 ProtoSequence 步骤索引
  const misaligned: StatisticalVerificationResult['misaligned_steps'] = [];
  const missing: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let bestMatch: { toolIndex: number; score: number } | null = null;

    for (let j = 0; j < toolDescriptions.length; j++) {
      if (matched.has(j)) continue;  // 每个工具调用只能匹配一个步骤

      // 简单字符串模糊匹配
      const score = fuzzyMatchScore(step.tentative_label, toolDescriptions[j]);
      // score = 1.0 if exact substring match
      // score = 0.8 if fuzzy match (Levenshtein < 3)
      // score = 0.0 if no match

      if (score > 0.6 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { toolIndex: j, score };
      }
    }

    if (bestMatch) {
      matched.add(bestMatch.toolIndex);
      if (bestMatch.toolIndex !== i) {
        // 位置不匹配（错位）
        misaligned.push({
          predicted_position: i + 1,
          predicted_label: step.tentative_label,
          found_at_position: bestMatch.toolIndex + 1,
        });
      }
    } else {
      // 完全未找到
      missing.push(step.tentative_label);
    }
  }

  // Step 2: 检测工具序列中有但 ProtoSequence 没有的步骤
  const unmatchedTools = toolTrace
    .filter((_, idx) => !matched.has(idx))
    .map(t => `${t.tool}: ${t.params_summary}`);
  const extraSteps = unmatchedTools.slice(0, 5);  // 最多 5 个

  // Step 3: 计算影响
  const matchRate = (steps.length - missing.length) / steps.length;

  // 置信度调整公式:
  //   完美匹配 (matchRate = 1.0 + 无错位) → +0.05 (小幅度正面信号)
  //   部分匹配 (matchRate = 0.6) → -0.05 ~ -0.1
  //   严重不匹配 (matchRate < 0.3) → -0.15 ~ -0.2
  const mismatchPenalty = (1 - matchRate) * 0.2 + misaligned.length * 0.02;
  const confidenceImpact = matchRate === 1 && misaligned.length === 0
    ? 0.05
    : -Math.min(mismatchPenalty, 0.2);

  // Step 4: 判断信号是否足够强
  // 如果工具调用太少 (< 3) 或 ProtoSequence 太短 (< 2)，信号可能不可靠
  const isConclusive = toolTrace.length >= 3 && steps.length >= 2;

  return {
    proto_id: protoSequence.proto_id,
    match_rate: matchRate,
    matched_steps: steps.filter((_, i) => !missing.includes(steps[i].tentative_label))
                       .map(s => s.tentative_label),
    misaligned_steps: misaligned,
    missing_steps: missing,
    extra_steps: extraSteps,
    confidence_impact: confidenceImpact,
    is_conclusive: isConclusive,
  };
}

// 简单字符串模糊匹配（不需要任何 ML 依赖）
function fuzzyMatchScore(target: string, candidate: string): number {
  const t = target.toLowerCase();
  const c = candidate.toLowerCase();

  // 完全子串匹配
  if (c.includes(t) || t.includes(c)) return 1.0;

  // 字符重叠率
  const tChars = new Set(t.replace(/\s/g, ''));
  const cChars = new Set(c.replace(/\s/g, ''));
  const intersection = new Set([...tChars].filter(ch => cChars.has(ch)));
  const union = new Set([...tChars, ...cChars]);

  return intersection.size / union.size;
}
```

---

## 三、置信度融合器（替代 V7 的单一信号更新）

```typescript
// orchestration/confidence-fuser.ts

interface ConfidenceFusionResult {
  proto_id: string;
  old_confidence: number;
  new_confidence: number;
  signals_used: {
    statistical?: StatisticalVerificationResult;
    llm_marker?: PredictionResult;
    user_correction?: UserCorrection;
  };
  fusion_strategy: 'both_agree' | 'both_disagree' | 'statistical_only' |
                   'llm_only' | 'user_correction' | 'contradiction';
  reason: string;
}

function fuseConfidence(
  proto: ProtoStructure,
  statisticalResult: StatisticalVerificationResult | null,
  llmMarkerResult: PredictionResult | null,
  userCorrection: UserCorrection | null,
  observationCount: number
): ConfidenceFusionResult {

  const oldConf = proto.confidence;
  let newConf = oldConf;
  let reason = '';
  let strategy: ConfidenceFusionResult['fusion_strategy'];

  // ── 优先级 0: 用户纠正（最高权重，直接覆盖） ──
  if (userCorrection) {
    newConf = oldConf - 0.4 * oldConf;
    reason = `用户明确纠正: ${userCorrection.detail}`;
    strategy = 'user_correction';
  }
  // ── 优先级 1: 双信号判断 ──
  else {
    const statSignal = statisticalResult?.is_conclusive
      ? (statisticalResult.confidence_impact < 0 ? 'fail' :
         statisticalResult.confidence_impact > 0 ? 'success' : 'uncertain')
      : null;

    const llmSignal = llmMarkerResult
      ? (llmMarkerResult.outcome === 'failed' ? 'fail' :
         llmMarkerResult.outcome === 'matched' ? 'success' : 'uncertain')
      : null;

    if (statSignal && llmSignal) {
      // ── 双信号都存在 ──
      if (statSignal === llmSignal) {
        // 两个独立信号一致 → 高置信度判断
        if (statSignal === 'fail') {
          newConf = oldConf - 0.2 * oldConf;
          reason = `双信号确认失败: 统计(${statisticalResult!.match_rate.toFixed(0)}) + LLM标记`;
          strategy = 'both_disagree';
        } else if (statSignal === 'success') {
          newConf = oldConf + 0.1 * (1 - oldConf);
          reason = `双信号确认成功: 统计(完全匹配) + LLM无标记`;
          strategy = 'both_agree';
        } else {
          newConf = oldConf;
          reason = '双信号均为不确定';
          strategy = 'both_agree';
        }
      } else {
        // 两个独立信号矛盾 → 偏向统计信号（独立源），但降低幅度
        strategy = 'contradiction';
        if (statSignal === 'fail') {
          newConf = oldConf - 0.05 * oldConf;  // 小幅度下调
          reason = `信号矛盾: 统计失败 vs LLM成功。偏向统计(独立源)，降幅降低。`;
        } else {
          newConf = oldConf;  // 矛盾时不做正面调整
          reason = `信号矛盾: 统计成功 vs LLM失败。保持现状。`;
        }
      }
    } else if (statSignal) {
      // ── 仅统计信号 ──
      newConf = oldConf + statisticalResult!.confidence_impact;
      reason = `仅统计信号: match_rate=${statisticalResult!.match_rate.toFixed(0)}`;
      strategy = 'statistical_only';
    } else if (llmSignal) {
      // ── 仅 LLM 标记 ──
      if (llmMarkerResult!.outcome === 'failed') {
        newConf = oldConf - 0.15 * oldConf;  // 略低于双信号确认的 -0.2
      } else if (llmMarkerResult!.outcome === 'matched') {
        newConf = oldConf + 0.08 * (1 - oldConf);
      } else {
        newConf = oldConf;
      }
      reason = `仅LLM标记: ${llmMarkerResult!.outcome}`;
      strategy = 'llm_only';
    } else {
      // ── 无信号 ──
      newConf = oldConf;
      reason = '无验证信号';
      strategy = 'statistical_only';  // 不重要
    }
  }

  // 确保置信度边界 + 早期观察折扣（同 V7）
  newConf = Math.max(0.05, Math.min(0.95, newConf));
  if (observationCount < 5) {
    newConf *= 1 - (5 - observationCount) * 0.1;
  }

  return {
    proto_id: proto.proto_id,
    old_confidence: oldConf,
    new_confidence: newConf,
    signals_used: {
      statistical: statisticalResult ?? undefined,
      llm_marker: llmMarkerResult ?? undefined,
      user_correction: userCorrection ?? undefined,
    },
    fusion_strategy: strategy,
    reason,
  };
}
```

---

## 四、累积 Transcript 分析器

这是 V8 替代 V7 的 `proto-constructor.ts` + `pattern-detector.ts` 的模块。

```typescript
// analysis/transcript-analyzer.ts

async function analyzeTranscripts(
  scenarioId: string,
  currentTranscript: SessionTranscript,
  historicalTranscripts: SessionTranscript[],
  existingProtos: ProtoStructure[],
  config: AgentOSConfig
): Promise<{
  newElements: SalientElement[];
  updatedProtos: ProtoStructure[];
  newProtos: ProtoStructure[];
  openQuestions: Question[];
}> {

  const allTranscripts = [currentTranscript, ...historicalTranscripts];

  // 构造一步到位的分析 prompt
  const prompt = buildCumulativeAnalysisPrompt(
    scenarioId,
    allTranscripts,
    existingProtos
  );

  // 调用 LLM（单次调用，不需要 PMI 预筛选）
  const result = await callLLM(prompt, {
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    maxTokens: 8000,
    timeout: config.analysisBudget.llmTimeoutMs,
    responseFormat: CUMULATIVE_ANALYSIS_SCHEMA,
  });

  return parseAnalysisResult(result, scenarioId);
}

function buildCumulativeAnalysisPrompt(
  scenarioId: string,
  transcripts: SessionTranscript[],
  existingProtos: ProtoStructure[]
): string {
  return `
你是 AgentOS 的认知分析模块。你的任务是分析同一场景的多次完整对话记录，
从中提取认知元素并更新认知结构。

## 场景信息
- 场景 ID: ${scenarioId}
- 对话次数: ${transcripts.length}
- 已形成的认知结构: ${existingProtos.length} 个

## 完整对话记录
${transcripts.map((t, i) => `
### 第 ${i + 1} 次对话
${t.messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}

工具调用序列:
${t.toolTrace.map(tt => `- ${tt.tool}(${tt.params_summary}) → ${tt.result_summary}`).join('\n')}
`).join('\n\n---\n\n')}

## 当前已有的 ProtoStructure
${existingProtos.map(p => `
- [${p.proto_type}] ${p.tentative_name} (置信度: ${p.confidence.toFixed(2)}, ${p.observations_count}次观察)
  关键反例: ${p.contradictions?.join('; ') || '无'}
`).join('\n')}

## 你的任务

请基于以上完整对话记录，完成以下分析：

### 1. SalientElement 提取
从每次对话中提取显著元素。一个"显著元素"是指：
- 反复出现的实体、行为、地点、关系
- 用户明确强调或纠正的内容
- 对话中隐含的流程步骤
- 不要提取寒暄、闲聊、或一次性提及的无关内容

### 2. ProtoStructure 更新
- 检测跨对话的模式（序列、角色、概念、目的）
- 更新已有的 ProtoStructure 或创建新的
- 标记每个结论的证据来源（第几次对话的第几条消息）
- 置信度要保守：对话次数 < 5 时，置信度不超过 0.6

### 3. 待验证问题
- 当前认知结构中最不确定的部分
- 需要向用户确认的假设

## 输出格式
{
  "new_elements": [
    {
      "raw_observation": "原文摘录",
      "element_type": "entity|action|place|relation|attribute|unknown",
      "tentative_label": "标签?（带问号=不确定）",
      "label_confidence": 0.5,
      "evidence_session": 1,
      "evidence_message": 3
    }
  ],
  "updated_protos": [
    {
      "proto_id": "已有原型的ID（更新）或新的ID（创建）",
      "proto_type": "sequence|role|concept|purpose",
      "tentative_name": "...",
      "confidence": 0.5,
      "changes_summary": "本次更新的内容",
      ... (具体结构数据)
    }
  ],
  "open_questions": ["问题1", "问题2"],
  "analysis_confidence": 0.6
}

## 重要原则
- 证据驱动：每个结论都要有明确的证据来源
- 保守置信度：观察次数少时不要过于自信
- 标记反例：如果同一模式在不同对话中有矛盾，明确标记
- 不要编造：如果证据不足，返回空数组
`;
}
```

---

## 五、自动固化阶梯

```typescript
// hooks/session-end.ts (固化部分)

async function checkCrystallization(
  protos: ProtoStructure[],
  config: AgentOSConfig,
  monthlyAutoCount: number
): Promise<CrystallizationAction[]> {

  const actions: CrystallizationAction[] = [];

  for (const proto of protos) {
    // ── 手动审批条件 ──
    if (proto.confidence >= 0.8 &&
        proto.observations_count >= 5 &&
        isConfidenceStable(proto)) {

      actions.push({
        type: 'propose_manual_approval',
        proto_id: proto.proto_id,
        proposal: await buildCrystallizationProposal(proto),
      });
    }

    // ── 自动固化条件 (Tier 1) ──
    if (config.autoCrystallization.enabled &&
        monthlyAutoCount < config.autoCrystallization.maxAutoPerMonth &&
        proto.confidence >= config.autoCrystallization.tier1.minConfidence &&
        proto.observations_count >= config.autoCrystallization.tier1.minObservations &&
        hasZeroUserCorrections(proto) &&
        isConfidenceStable(proto)) {

      actions.push({
        type: 'auto_crystallize_tier1',
        proto_id: proto.proto_id,
        proposal: await buildCrystallizationProposal(proto, { auto: true, tier: 1 }),
      });
    }

    // ── 自动固化条件 (Tier 2) ──
    if (config.autoCrystallization.enabled &&
        monthlyAutoCount < config.autoCrystallization.maxAutoPerMonth &&
        proto.confidence >= config.autoCrystallization.tier2.minConfidence &&
        proto.observations_count >= config.autoCrystallization.tier2.minObservations &&
        hasZeroUserCorrections(proto) &&
        hasCrossSceneConsistency(proto) &&
        isConfidenceStable(proto)) {

      actions.push({
        type: 'auto_crystallize_tier2',
        proto_id: proto.proto_id,
        proposal: await buildCrystallizationProposal(proto, { auto: true, tier: 2 }),
      });
    }
  }

  return actions;
}

// 自动固化的回滚保护
// 自动固化的结构有更低的退化阈值:
//   auto_crystallized: accuracy < 0.6 → 退化（而非 0.7）
//   manual_approved:   accuracy < 0.7 → 退化
function getDegradationThreshold(structure: CognitiveStructure): number {
  return structure.evolution?.created_by === 'auto_crystallization'
    ? 0.6   // 自动固化 → 更容易回滚
    : 0.7;  // 人工审批 → 更稳定
}
```

---

## 六、实时退化检测（session_end 内联）

```typescript
// analysis/degradation-checker.ts (V8 增强版)

async function checkDegradationRealtime(
  sessionContext: SessionContext,
  activeStructures: ProtoStructure[],
  crystallizedStructures: CognitiveStructure[]
): Promise<DegradationEvent[]> {

  const events: DegradationEvent[] = [];

  // 1. 单次会话严重失败 → 立即怀疑
  const sessionFailures = sessionContext.predictionResults
    .filter(r => r.outcome === 'failed');

  for (const failure of sessionFailures) {
    const proto = activeStructures.find(p => p.proto_id === failure.proto_id);
    if (proto && proto.confidence > 0.7) {
      // 高置信度结构在本会话中失败 → 高信号
      events.push({
        type: 'degradation_suspected',
        structure_id: proto.proto_id,
        reason: `置信度 ${proto.confidence.toFixed(2)} 的结构在本会话中预测失败: ${failure.detail}`,
        severity: proto.confidence > 0.85 ? 'high' : 'medium',
      });
    }
  }

  // 2. 连续 3 次失败（跨会话）→ 确认退化
  for (const structure of [...activeStructures, ...crystallizedStructures]) {
    const recentSessions = await loadRecentSessions(structure.structure_id ?? structure.proto_id, 5);
    const recentFailures = recentSessions.filter(s => s.prediction_failed);

    if (recentFailures.length >= 3) {
      events.push({
        type: 'degradation_confirmed',
        structure_id: structure.structure_id ?? structure.proto_id,
        reason: `连续 ${recentFailures.length} 次会话中预测失败`,
        severity: 'high',
      });
    }
  }

  return events;
}
```

---

## 七、本地缓存降级

```typescript
// memory/local-cache.ts

interface CacheEntry {
  key: string;
  value: any;
  writtenAt: number;
  synced: boolean;
}

class LocalCache {
  private cachePath: string;
  private ttlMs: number = 7 * 24 * 60 * 60 * 1000;  // 7 天

  async get(key: string): Promise<any | null> {
    const entry = await this.readEntry(key);
    if (!entry) return null;
    if (Date.now() - entry.writtenAt > this.ttlMs) {
      await this.deleteEntry(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: any): Promise<void> {
    await this.writeEntry({
      key, value,
      writtenAt: Date.now(),
      synced: false,
    });
  }

  async syncToAgentMemory(agentMemory: AgentMemoryClient): Promise<number> {
    const unsynced = await this.getUnsyncedEntries();
    let synced = 0;

    for (const entry of unsynced) {
      try {
        await agentMemory.save(entry.key, entry.value);
        await this.markSynced(entry.key);
        synced++;
      } catch (e) {
        console.warn(`[AgentOS] Failed to sync ${entry.key}: ${e}`);
      }
    }

    return synced;
  }

  // ... (文件读写实现)
}
```

---

## 八、结构生命周期管理（长期运行的认知卫生）

```typescript
// analysis/structure-lifecycle.ts

interface LifecycleAction {
  type: 'archive' | 'cleanup_suggest' | 'downgrade' | 'noop';
  structure_id: string;
  reason: string;
  suggested_action: string;
}

async function checkStructureLifecycle(
  protoStructures: ProtoStructure[],
  cognitiveStructures: CognitiveStructure[],
  config: AgentOSConfig
): Promise<LifecycleAction[]> {

  const actions: LifecycleAction[] = [];
  const now = Date.now();
  const threeMonthsMs = 90 * 24 * 60 * 60 * 1000;

  // ── ProtoStructure 生命周期检查 ──
  for (const proto of protoStructures) {

    // 归档: 3 个月未激活
    const lastActive = proto.last_activated_at ?? proto.last_updated_at;
    if (now - lastActive > threeMonthsMs) {
      actions.push({
        type: 'archive',
        structure_id: proto.proto_id,
        reason: `超过 3 个月未激活 (最后激活: ${new Date(lastActive).toISOString()})`,
        suggested_action: '移出默认注入列表，保留在 AgentMemory 中可通过检索访问',
      });
    }

    // 清理建议: 置信度 < 0.2 + 观察 > 10 + 3 个月无变化
    if (proto.confidence < 0.2 &&
        proto.observations_count > 10 &&
        isStagnant(proto, threeMonthsMs)) {
      actions.push({
        type: 'cleanup_suggest',
        structure_id: proto.proto_id,
        reason: `置信度 ${proto.confidence.toFixed(2)} 持续停滞超过 3 个月 (${proto.observations_count}次观察)`,
        suggested_action: '建议通知用户: 此结构可能为错误假设，是否清理？',
      });
    }
  }

  // ── CognitiveStructure 生命周期检查 ──
  for (const structure of cognitiveStructures) {

    // 降级: 每月使用频率 < 1 次
    const monthlyUsage = getMonthlyUsageRate(structure);
    if (monthlyUsage < 1 && structure.status === 'crystallized') {
      actions.push({
        type: 'downgrade',
        structure_id: structure.structure_id,
        reason: `月使用频率 ${monthlyUsage.toFixed(1)} 次 < 1`,
        suggested_action: '降级为 ProtoStructure，置信度保留 0.7',
      });
    }
  }

  return actions;
}

// ── 自适应累积分析策略 ──
function getAnalysisStrategy(observationCount: number): 'full' | 'incremental' | 'sampled' {
  if (observationCount <= 5) return 'full';        // 全量分析所有历史 transcript
  if (observationCount <= 20) return 'incremental'; // 最近 5 次 + 现有结构摘要
  return 'sampled';                                  // 分层采样
}

async function analyzeTranscriptsAdaptive(
  scenarioId: string,
  currentTranscript: SessionTranscript,
  observationCount: number,
  existingProtos: ProtoStructure[],
  config: AgentOSConfig
): Promise<AnalysisResult> {

  const strategy = getAnalysisStrategy(observationCount);

  switch (strategy) {
    case 'full':
      // 加载全部历史 transcript（N ≤ 5）
      const allHistory = await loadHistoricalTranscripts(scenarioId, { limit: 5 });
      return analyzeTranscripts(scenarioId, currentTranscript, allHistory, existingProtos, config);

    case 'incremental':
      // 加载最近 5 次 + 现有 ProtoStructure 摘要作为上下文
      const recentHistory = await loadHistoricalTranscripts(scenarioId, { limit: 5 });
      const protoSummary = buildProtoStructureSummary(existingProtos);  // ~2K tokens
      return analyzeTranscripts(scenarioId, currentTranscript, recentHistory, existingProtos, config);
      // (在 prompt 中附加 protoSummary 作为 "先前分析的历史背景")

    case 'sampled':
      // 分层采样: 最早 1 次 + 中间 2 次 + 最近 3 次 = 共 6 次
      const sampled = await loadHistoricalTranscriptsStratified(scenarioId, {
        earliest: 1, middle: 2, recent: 3,
      });
      const protoSummaryFull = buildProtoStructureSummary(existingProtos);
      return analyzeTranscripts(scenarioId, currentTranscript, sampled, existingProtos, config);
  }
}
```

---

## 兄弟文件

- [What is AgentOS V8?](what-is.md) — V8 的工程定义
- [Why AgentOS V8?](why.md) — 第一性原理：为什么 1M 上下文改变了架构
- [Who is it for?](who.md) — 角色职责的变化
- [When does it operate?](when.md) — 简化的实现路线图
- [Where does it sit?](where.md) — 模块树（删除 + 新增 + 修改）
- [Architecture Design](design.md) — 技术规格与 API 契约
