# How does Praxis V7 work?

> V7 的工程实现详解：从 Hook 编排到 Prompt 工程，从置信度算法到 AgentMemory 集成。

---

## 一、核心编排逻辑（伪代码）

### 1.1 插件入口

```typescript
// index.ts
export default function praxisPlugin(config: PraxisConfig): OpenClawPlugin {
  return {
    name: 'praxis',
    version: '7.0.0',
    
    hooks: {
      session_start:   createSessionStartHandler(config),
      message_received: createMessageReceivedHandler(config),
      before_tool_call: createBeforeToolCallHandler(config),
      after_tool_call:  createAfterToolCallHandler(config),
      agent_end:       createAgentEndHandler(config),
      session_end:     createSessionEndHandler(config),
    },
    
    crons: [
      { schedule: '0 2 * * 0', handler: patternAuditCron },
      { schedule: '0 3 * * 0', handler: degradationCheckCron },
      { schedule: '0 4 1 * *', handler: architectureAuditCron },
    ],
  };
}
```

### 1.2 场景匹配算法

```typescript
// orchestration/scene-matcher.ts

interface SceneMatch {
  structure: CognitiveStructure | ProtoStructure | null;
  adaptationScore: number;   // 0.0 - 1.0
  matchType: 'exact' | 'fuzzy' | 'weak' | 'zero_prior';
}

function matchScene(
  messages: Message[],
  structureRegistry: CognitiveStructure[],
  activeProtos: ProtoStructure[]
): SceneMatch {
  
  // Step 1: 提取场景特征
  const features = extractSceneFeatures(messages);
  // features = { keywords, entities, intent, domain_hints }
  
  // Step 2: 遍历固化结构，计算适配度
  let bestMatch: SceneMatch = { structure: null, adaptationScore: 0, matchType: 'zero_prior' };
  
  for (const structure of structureRegistry) {
    const score = calculateAdaptationScore(features, structure);
    // score = weighted_sum(
    //   keyword_match * 0.3 +
    //   semantic_similarity(features.entities, structure.applies_to) * 0.4 +
    //   user_marked_scenario_match * 0.3
    // )
    
    if (score > bestMatch.adaptationScore) {
      bestMatch = { structure, adaptationScore: score, matchType: classifyMatch(score) };
    }
  }
  
  // Step 3: 分类匹配类型
  function classifyMatch(score: number): MatchType {
    if (score > 0.7) return 'exact';      // 确定场景
    if (score > 0.3) return 'fuzzy';      // 模糊匹配 → V5 监控
    if (score > 0)   return 'weak';       // 弱匹配
    return 'zero_prior';                   // 零先验
  }
  
  // Step 4: 零先验场景 → 查找是否有活跃的 ProtoStructure
  if (bestMatch.matchType === 'zero_prior') {
    const scenarioKey = generateScenarioKey(features);
    const proto = activeProtos.find(p => p.scenario_id === scenarioKey);
    if (proto) {
      bestMatch.structure = proto;
      bestMatch.adaptationScore = proto.confidence; // 不是适配度，是原型置信度
    }
  }
  
  return bestMatch;
}
```

---

## 二、SalientElement 预标记（本地，无需 LLM）

这是 V7 中唯一不需要 LLM 的"智能"操作。通过正则 + 词频统计在 `message_received` 中实时执行。

```typescript
// orchestration/salience-marker.ts

interface CandidateElement {
  raw_text: string;
  element_type: 'entity' | 'action' | 'place' | 'relation' | 'attribute' | 'unknown';
  salience_signals: SalienceSignal[];
  tentative_label: string | null;
  confidence: number;      // 本地预标记的置信度（不是最终置信度）
  timestamp: number;
}

function markSalientElements(
  message: string,
  historyBuffer: CandidateElement[],
  sessionContext: SessionContext
): CandidateElement[] {
  
  const candidates: CandidateElement[] = [];
  
  // ── 信号 1: 重复检测 ──
  // 对消息中的每个名词短语，检查在近期消息中的出现次数
  const nounPhrases = extractNounPhrases(message);  // 简单的 NLP: 名词+名词组合
  for (const phrase of nounPhrases) {
    const recentCount = countOccurrences(phrase, historyBuffer, { window: 10 });
    if (recentCount >= 2) {
      candidates.push({
        raw_text: phrase,
        element_type: 'unknown',
        salience_signals: [{ type: 'repetition', detail: `近 10 条消息中出现 ${recentCount} 次` }],
        tentative_label: `${phrase}?`,
        confidence: Math.min(0.3 + recentCount * 0.1, 0.7),
        timestamp: Date.now(),
      });
    }
  }
  
  // ── 信号 2: 用户强调词 ──
  const emphasisPatterns = [
    /注意[：:]\s*(.+)/g,
    /关键[是].*(.+)/g,
    /你必须知道[：:]?\s*(.+)/g,
    /重要[的]是[：:]?\s*(.+)/g,
    /记住[：:]?\s*(.+)/g,
    /首先[，,]?\s*(.+)/g,
  ];
  for (const pattern of emphasisPatterns) {
    const matches = message.matchAll(pattern);
    for (const match of matches) {
      candidates.push({
        raw_text: match[1],
        element_type: 'unknown',
        salience_signals: [{ type: 'user_emphasis', detail: '用户用强调词标记' }],
        tentative_label: `${match[1].substring(0, 20)}?`,
        confidence: 0.5,  // 用户强调 = 中等置信度
        timestamp: Date.now(),
      });
    }
  }
  
  // ── 信号 3: 序列词 ──
  const sequencePatterns = [
    /先[要]*[：:]?\s*(.+?)[，,;；再然后]/g,
    /第一[步个].*第二[步个]/g,
    /首先.*其次.*最后/g,
  ];
  for (const pattern of sequencePatterns) {
    const matches = message.matchAll(pattern);
    for (const match of matches) {
      candidates.push({
        raw_text: match[0],
        element_type: 'action',
        salience_signals: [{ type: 'sequence_position', detail: '用户描述了顺序' }],
        tentative_label: null,  // 序列太复杂，label 留给 LLM
        confidence: 0.4,
        timestamp: Date.now(),
      });
    }
  }
  
  // ── 信号 4: 用户情绪 ──
  const frustrationPatterns = [/不对/, /不是这样/, /你又搞错了/, /重新来/];
  const urgencyPatterns = [/紧急/, /马上/, /立刻/, /快/];
  
  if (frustrationPatterns.some(p => p.test(message))) {
    // 找到消息中最可能的纠正目标
    const correctionTarget = extractCorrectionTarget(message);
    if (correctionTarget) {
      candidates.push({
        raw_text: correctionTarget,
        element_type: 'unknown',
        salience_signals: [{ type: 'user_correction', detail: '用户在纠正某个理解' }],
        tentative_label: null,
        confidence: 0.7,  // 纠正信号 = 高置信度
        timestamp: Date.now(),
      });
    }
  }
  
  // ── 信号 5: 未见过的新词 ──
  // 与已知的 domain keywords 对比，标记未知词汇
  const knownKeywords = sessionContext.knownKeywords ?? [];
  const tokens = tokenize(message);
  const unknownTokens = tokens.filter(t => 
    t.length >= 2 && !knownKeywords.includes(t) && !isStopWord(t)
  );
  for (const token of unknownTokens.slice(0, 5)) {  // 最多 5 个
    candidates.push({
      raw_text: token,
      element_type: 'unknown',
      salience_signals: [{ type: 'novelty', detail: '未在已知词汇中出现' }],
      tentative_label: `${token}?`,
      confidence: 0.15,  // 新颖性 = 低初始置信度
      timestamp: Date.now(),
    });
  }
  
  return candidates;
}
```

---

## 三、ProtoStructure 构造（session_end + LLM）

### 3.1 统计预筛选

```typescript
// analysis/pattern-detector.ts

interface CooccurrencePair {
  element_a: string;
  element_b: string;
  temporal_adjacency: number;    // A 在 B 之前出现的次数
  same_session_count: number;    // A 和 B 共同出现在同会话的次数
  mutual_information: number;    // 互信息
  pmi: number;                   // 点互信息
}

function detectCooccurrencePatterns(
  elements: SalientElement[],     // 本场景的所有元素
  sessions: SessionTrace[]        // 本场景的历史会话
): CooccurrencePair[] {
  
  const pairs: Map<string, CooccurrencePair> = new Map();
  
  // 统计时间邻接
  for (const session of sessions) {
    const sessionElements = session.elements.sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < sessionElements.length - 1; i++) {
      for (let j = i + 1; j < sessionElements.length; j++) {
        const key = `${sessionElements[i].element_id}:${sessionElements[j].element_id}`;
        const pair = pairs.get(key) || createEmptyPair(sessionElements[i], sessionElements[j]);
        pair.temporal_adjacency++;
        pairs.set(key, pair);
      }
    }
  }
  
  // 计算互信息
  const totalObservations = sessions.reduce((s, sess) => s + sess.elements.length, 0);
  for (const pair of pairs.values()) {
    const p_a = countOccurrences(pair.element_a, sessions) / totalObservations;
    const p_b = countOccurrences(pair.element_b, sessions) / totalObservations;
    const p_ab = pair.same_session_count / sessions.length;
    
    if (p_a > 0 && p_b > 0 && p_ab > 0) {
      pair.pmi = Math.log2(p_ab / (p_a * p_b));
    }
  }
  
  // 只返回 PMI > 1.0 的显著共现对（统计上非随机）
  return Array.from(pairs.values())
    .filter(p => p.pmi > 1.0)
    .sort((a, b) => b.pmi - a.pmi);
}
```

### 3.2 LLM 语义归纳

```typescript
// analysis/proto-constructor.ts

async function constructProtoStructures(
  scenarioId: string,
  salientElements: SalientElement[],
  cooccurrencePairs: CooccurrencePair[],
  observationCount: number
): Promise<ProtoStructure[]> {
  
  // 构造 LLM prompt
  const prompt = buildProtoConstructionPrompt(
    scenarioId,
    salientElements,
    cooccurrencePairs,
    observationCount
  );
  
  // 调用 LLM（使用结构化输出）
  const result = await callLLM(prompt, {
    model: 'claude-sonnet-4-6',  // 分析任务不需要最强模型
    temperature: 0.3,            // 低温度减少随机性
    maxTokens: 4000,
    responseFormat: PROTO_STRUCTURE_SCHEMA,  // JSON Schema
  });
  
  return parseProtoStructures(result, scenarioId, observationCount);
}

function buildProtoConstructionPrompt(
  scenarioId: string,
  elements: SalientElement[],
  pairs: CooccurrencePair[],
  count: number
): string {
  return `
你是 Praxis 的认知分析模块。你的任务是分析在同一个场景类型中观察到的元素，
从中检测可能的结构模式。

## 场景信息
- 场景 ID: ${scenarioId}
- 观察次数: ${count} 次

## 观察到的显著元素（按首次出现时间排序）
${elements.map((e, i) => `
${i + 1}. [${e.element_type}] "${e.raw_observation}"
   - 标签: ${e.tentative_label || '未标记'}
   - 显著性信号: ${e.salience_signals.map(s => s.type).join(', ')}
   - 出现次数: ${e.observations.length}
`).join('\n')}

## 统计上显著的共现模式
${pairs.map(p => `
- "${p.element_a}" → "${p.element_b}"
  时间邻接次数: ${p.temporal_adjacency}, PMI: ${p.pmi.toFixed(2)}
`).join('\n')}

## 请分析并输出以下结构（JSON格式）:

1. **ProtoSequence**: 哪些元素似乎形成序列？
   - 对每个检测到的序列，列出元素顺序和每个位置的置信度
   - 注意: 统计共现中 PMI > 1.5 的序列通常更可靠

2. **ProtoRole**: 哪些元素集合似乎由同一个"角色"完成？
   - 聚合由同一类执行者完成的元素
   - 给出角色的试探性名称和职责描述

3. **ProtoConcept**: 哪些元素集合构成一个"概念"或"类别"？
   - 聚合语义上属于同一领域的元素
   - 给出概念假设和置信度

4. **ProtoPurpose**: 整个场景似乎在达成什么目标？
   - 给出现象级的描述（不要过度抽象）

## 输出格式
{
  "proto_sequences": [
    {
      "tentative_name": "标准流程",
      "sequence": [
        {"position": 1, "element_ref": "xxx", "tentative_label": "挂号", "confidence": 0.6},
        ...
      ],
      "overall_confidence": 0.5,
      "evidence_summary": "基于 X 次观察中的 Y 次一致"
    }
  ],
  "proto_roles": [...],
  "proto_concepts": [...],
  "proto_purpose": {...},
  "open_questions": ["需要更多观察来确认的问题"],
  "analysis_confidence": 0.6
}

## 重要原则
- 置信度要保守。观察次数少(< 5)时，置信度不应超过 0.6
- 标记明显的反例和不确定性
- 对于纯粹基于 1-2 次观察的模式，标注为 "tentative"
- 如果证据不足以形成任何结构，返回空数组——不要编造
`;
}
```

### 3.3 ProtoStructure JSON Schema

```typescript
// types/memory.ts

const PROTO_STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    proto_id: { type: 'string' },
    scenario_id: { type: 'string' },
    type: { enum: ['sequence', 'role', 'concept', 'purpose'] },
    tentative_name: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    
    // 对于 ProtoSequence
    sequence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          position: { type: 'integer' },
          element_ref: { type: 'string' },
          tentative_label: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
    
    // 对于 ProtoRole
    defining_behaviors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          behavior: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
    
    observations_count: { type: 'integer' },
    contradictions: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
    confidence_trend: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          after_observation: { type: 'integer' },
          confidence: { type: 'number' },
        },
      },
    },
    
    created_at: { type: 'string', format: 'date-time' },
    last_updated_at: { type: 'string', format: 'date-time' },
  },
  required: ['proto_id', 'scenario_id', 'type', 'confidence', 'observations_count'],
};
```

---

## 四、置信度更新算法

```typescript
// orchestration/confidence-updater.ts

interface ConfidenceUpdate {
  protoId: string;
  oldConfidence: number;
  newConfidence: number;
  reason: string;
  direction: 'increased' | 'decreased' | 'unchanged';
}

function updateConfidence(
  proto: ProtoStructure,
  predictionResult: PredictionResult,
  observationCount: number
): ConfidenceUpdate {
  
  const oldConf = proto.confidence;
  let newConf = oldConf;
  let reason = '';
  
  switch (predictionResult.outcome) {
    case 'matched':
      // 预测正确: 小幅度增加（上限减速）
      // 公式: new = old + 0.1 * (1 - old)
      //   当 old=0.3: new=0.37 (+0.07)
      //   当 old=0.7: new=0.73 (+0.03)
      //   当 old=0.9: new=0.91 (+0.01)
      newConf = oldConf + 0.1 * (1 - oldConf);
      reason = `预测 "${predictionResult.predicted}" 匹配实际 "${predictionResult.actual}"`;
      break;
      
    case 'failed':
      // 预测错误: 较大幅度减少（错误信息量更大）
      // 公式: new = old - 0.2 * old
      //   当 old=0.3: new=0.24 (-0.06)
      //   当 old=0.7: new=0.56 (-0.14)
      //   当 old=0.9: new=0.72 (-0.18)
      newConf = oldConf - 0.2 * oldConf;
      reason = `预测 "${predictionResult.predicted}" 被实际 "${predictionResult.actual}" 推翻`;
      break;
      
    case 'uncertain':
      // 无法判断: 不变
      newConf = oldConf;
      reason = '无法判断预测结果';
      break;
      
    case 'user_correction':
      // 用户明确纠正: 大幅调整
      // 用户纠正 = 最高权重信号
      newConf = oldConf - 0.4 * oldConf;
      reason = `用户明确纠正: "${predictionResult.correctionDetail}"`;
      
      // 同时：将纠正的内容直接设为新的高置信度假设
      if (predictionResult.correctedValue) {
        // 这会在后续处理中被添加到 ProtoStructure 的修正维度
        predictionResult.correctionApplied = true;
      }
      break;
  }
  
  // 确保置信度在 [0.05, 0.95] 范围内（不完全确定也不完全否定）
  newConf = Math.max(0.05, Math.min(0.95, newConf));
  
  // 早期观察的置信度折扣（观察次数少 → 置信度额外打折）
  if (observationCount < 5) {
    const discount = 1 - (5 - observationCount) * 0.1;  // 1次: 0.6, 2次: 0.7, ..., 5次: 1.0
    newConf *= discount;
  }
  
  return {
    protoId: proto.proto_id,
    oldConfidence: oldConf,
    newConfidence: newConf,
    reason,
    direction: newConf > oldConf ? 'increased' : newConf < oldConf ? 'decreased' : 'unchanged',
  };
}
```

---

## 五、预测标记协议

### 5.1 系统提示中给 LLM 的指令

```
## Praxis 预测标记协议

你在执行任务时，会收到 Praxis 注入的"场景理解"——这是从过去观察中形成的
概率性模式。它们不是确定的规则。

当你的操作与这些模式一致时，在你行动的理由中提及即可（不需要标记）。

当你的操作与这些模式**不一致**时，在你的回复中使用以下标记:

[PREDICTION_FAILED: 简短描述你的预期与实际不符的地方]

例如:
"根据过去观察，挂号之后应该是等待叫号。但这次挂号之后直接去见了医生。
[PREDICTION_FAILED: 挂号→等待叫号的模式被打破，本次挂号后直接问诊]"

当你不确定预测是否正确时:
[PREDICTION_UNCERTAIN: 简短描述]

不要在每次操作中都使用这些标记——只在模式被打破或你无法判断时使用。
```

### 5.2 agent_end 中的解析

```typescript
// orchestration/prediction-protocol.ts

function parsePredictionMarkers(agentOutput: string): PredictionResult[] {
  const results: PredictionResult[] = [];
  
  // 匹配 [PREDICTION_FAILED: ...]
  const failedPattern = /\[PREDICTION_FAILED:\s*([^\]]+)\]/g;
  for (const match of agentOutput.matchAll(failedPattern)) {
    results.push({
      outcome: 'failed',
      predicted: extractPredictedFromContext(match[1]),
      actual: extractActualFromContext(match[1]),
      detail: match[1].trim(),
    });
  }
  
  // 匹配 [PREDICTION_UNCERTAIN: ...]
  const uncertainPattern = /\[PREDICTION_UNCERTAIN:\s*([^\]]+)\]/g;
  for (const match of agentOutput.matchAll(uncertainPattern)) {
    results.push({
      outcome: 'uncertain',
      detail: match[1].trim(),
    });
  }
  
  return results;
}
```

---

## 六、Prompt 注入策略

### 6.1 零先验场景的系统提示注入

```
# 当前场景感知状态

你正在处理一个你**不熟悉**的场景类型。Praxis 通过过去的观察
积累了一些初步的模式理解。这些理解是**概率性的、可修正的**——
它们不是确定的规则。

## 你对当前场景的理解

### 观察到的基本流程（置信度 {{proto_sequence.confidence}}）
{% for step in proto_sequence.sequence %}
{{ step.position }}. {{ step.tentative_label }} (置信度 {{ step.confidence }})
{% endfor %}

### 观察到的角色（置信度 {{proto_role.confidence}}）
- {{ proto_role.tentative_name }}: {{ proto_role.defining_behaviors | join(", ") }}

### 场景目标假设（置信度 {{proto_purpose.confidence}}）
{{ proto_purpose.hypothesis }}

## 你的任务

1. 执行用户指令的同时，验证或推翻上述模式
2. 当实际情况与上述模式显著不符时，使用 [PREDICTION_FAILED: ...] 标记
3. 如果用户的回答揭示了上述模式的错误，礼貌地纠正你的理解
4. 如果有机会澄清上述模式中的不确定点，用自然对话的方式提问

## 注意
- 上述置信度 < 0.5 的模式仅供参考，不要基于它们做关键决策
- 每次成功的预测会小幅提高置信度
- 每次失败的预测会显著降低置信度
```

### 6.2 确定场景的系统提示注入

```
# 场景: {{structure.name}} v{{structure.version}}
# 适配度: {{adaptation_score}}

## 标准流程
{{structure.process_summary}}

## 当前步骤
{{current_step.guidance}}

## 涉及角色
{{structure.roles | map("name") | join(", ")}}
```

### 6.3 弱匹配场景的系统提示注入

```
# ⚠️ 当前场景与已知模式匹配度较低（{{adaptation_score}}）

最接近的已知模式是"{{structure.name}}"，但匹配度仅为 {{adaptation_score}}。
请保持警惕——实际流程可能与预期有显著差异。

## 参考模式（不要盲从）
{{structure.process_summary}}

## 如果发现显著差异
使用 [PREDICTION_FAILED: ...] 标记，Praxis 会记录并用于改进场景匹配。
```

---

## 七、固化与退化实现

### 7.1 固化数据转换

```typescript
// analysis/proto-constructor.ts (固化部分)

async function proposeCrystallization(
  proto: ProtoStructure,
  scenarioId: string
): Promise<CrystallizationProposal | null> {
  
  // 检查固化条件
  if (proto.confidence < 0.8) return null;
  if (proto.observations_count < 5) return null;
  
  // 检查最近稳定性（最近 3 次置信度变化 < 0.05）
  const recentTrend = proto.confidence_trend?.slice(-3) ?? [];
  const isStable = recentTrend.length >= 3 &&
    Math.max(...recentTrend.map(t => t.confidence)) -
    Math.min(...recentTrend.map(t => t.confidence)) < 0.05;
  if (!isStable) return null;
  
  // 数据格式转换: ProtoStructure → CognitiveStructure
  const candidateStructure: CognitiveStructure = {
    structure_id: `crystallized_${proto.proto_id}`,
    name: proto.tentative_name,
    version: '1.0.0',
    status: 'candidate',
    applies_to: [scenarioId],
    activation_priority: 0.5,
    
    core_model: {
      data_models: convertProtoToDataModels(proto),
      process: convertProtoToProcess(proto),
      decision_logic: [],
    },
    
    integration: {
      uses: ['RoleModel', 'message_received', 'message_sending'],
      overrides: [],
      conflicts_with: [],
    },
    
    validation: {
      experiments_count: 0,
      success_rate: 0,
      user_satisfaction: 0,
      compared_to_baseline: null,
      regression_checked: false,
    },
    
    evolution: {
      created_from: `proto_${proto.proto_id}`,
      created_by: 'proto_cognitive_engine_v7',
      created_at: new Date().toISOString(),
      supersedes: null,
      superseded_by: null,
      version_history: [],
      evolution_chain: [{
        from_type: 'proto_structure',
        from_id: proto.proto_id,
        transition: 'crystallization_proposed',
        confidence_at_transition: proto.confidence,
        observations_used: proto.observations_count,
      }],
    },
  };
  
  const proposal: CrystallizationProposal = {
    proposal_id: `cryst_${Date.now()}`,
    proto_id: proto.proto_id,
    candidate_structure: candidateStructure,
    evidence: {
      observations_count: proto.observations_count,
      final_confidence: proto.confidence,
      confidence_trend: proto.confidence_trend ?? [],
      key_supporting_observations: proto.observations?.slice(-5) ?? [],
      known_contradictions: proto.contradictions ?? [],
    },
    status: 'pending_user_approval',
    created_at: new Date().toISOString(),
  };
  
  return proposal;
}
```

### 7.2 退化检测

```typescript
// analysis/degradation-checker.ts

async function checkDegradation(
  structures: CognitiveStructure[],
  recentSessions: SessionTrace[]
): Promise<DegradationReport> {
  
  const degraded: DegradationEvent[] = [];
  
  for (const structure of structures) {
    // 只检查 crystallized 状态的结构
    if (structure.status !== 'crystallized') continue;
    
    const structureSessions = recentSessions.filter(
      s => s.matched_structure === structure.structure_id
    );
    
    if (structureSessions.length < 3) continue;  // 使用次数太少，不检查
    
    // 检查预测准确率
    const predictionResults = structureSessions.flatMap(s => s.prediction_results);
    const total = predictionResults.length;
    const failures = predictionResults.filter(r => r.outcome === 'failed').length;
    const accuracy = total > 0 ? (total - failures) / total : 1.0;
    
    // 检查反例数量
    const contradictions = structureSessions.flatMap(s => s.contradictions ?? []);
    
    // 退化条件
    const shouldDegrade =
      accuracy < 0.7 ||
      contradictions.length > 3 ||
      structureSessions.some(s => s.user_marked_wrong);
    
    if (shouldDegrade) {
      degraded.push({
        structure_id: structure.structure_id,
        current_status: 'crystallized',
        new_status: 'degraded',
        reason: accuracy < 0.7
          ? `预测准确率降至 ${(accuracy * 100).toFixed(0)}%`
          : contradictions.length > 3
            ? `累计 ${contradictions.length} 个反例`
            : '用户标记为理解错误',
        metrics: {
          recent_accuracy: accuracy,
          total_failures: failures,
          contradiction_count: contradictions.length,
        },
        degraded_confidence: structure.validation?.success_rate
          ? structure.validation.success_rate * 0.7
          : 0.5,
      });
    }
  }
  
  return { degraded, checked_at: new Date().toISOString() };
}
```

---

## 兄弟文件

- [What is Praxis V7?](what-is.md) — V7 的工程定义
- [Why Praxis V7?](why.md) — 第一性原理工程可行性分析
- [Who is it for?](who.md) — 开发者、运维者、用户三角色
- [When does it operate?](when.md) — 实现路线图与分阶段交付
- [Where does it sit?](where.md) — 工程架构与模块划分
- [Architecture Design](design.md) — 技术规格与 API 契约
