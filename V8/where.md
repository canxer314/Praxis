# Where does Praxis V8 sit?

> V8 定义 1M 上下文下 Praxis 的工程位置：简化后的模块树、删除的模块、新增的模块、数据流变化。

---

## 一、完整模块树

```
openclaw/src/plugins/praxis-plugin/
├── index.ts                          # 插件入口
├── config.ts                         # 配置（新增自动固化、注意力预算）
│
├── hooks/
│   ├── session-start.ts             # [重写] 场景识别 + 全量加载 + 层级化组织 + 注入
│   ├── message-received.ts          # [简化] 仅归档原始消息到 transcript buffer
│   ├── before-tool-call.ts          # [保留] 注入步骤级上下文
│   ├── after-tool-call.ts           # [增强] 记录工具调用 → 统计验证用
│   ├── agent-end.ts                 # [重写] 统计验证 + LLM 标记 + 融合
│   └── session-end.ts              # [重写] 累积 transcript 分析 → 一步 LLM
│
├── orchestration/
│   ├── scene-recognizer.ts          # [新] 场景识别 (从 scene-matcher 保留的认知功能)
│   ├── context-organizer.ts         # [新] 层级化组织 + 相关性预排序 + 置信度校准
│   ├── confidence-fuser.ts          # [新] 多源置信度融合 (替代 confidence-updater)
│   └── prediction-protocol.ts       # [简化] LLM 标记解析 (降级为辅助信号)
│
├── analysis/
│   ├── transcript-analyzer.ts       # [新] 完整 transcript → SalientElement + ProtoStructure
│   ├── statistical-verifier.ts      # [新] 工具序列 vs ProtoSequence 统计比对
│   ├── degradation-checker.ts       # [增强] session_end 实时 + cron 深度
│   ├── structure-lifecycle.ts       # [新] 结构归档/清理/降级 (长期运行的认知卫生)
│   └── architecture-auditor.ts      # [增强] 对抗性 prompt 交叉验证
│
├── memory/
│   ├── client.ts                    # [增强] AgentMemory MCP 客户端
│   ├── local-cache.ts               # [新] AgentMemory 不可用时的降级缓存
│   ├── schemas.ts                   # 存储格式定义
│   ├── slots.ts                     # Slot 读写操作
│   └── queries.ts                   # 常用查询封装
│
├── prompts/
│   ├── system/
│   │   ├── memory-context.md        # [新] 层级化记忆注入模板
│   │   └── prediction-markers.md    # [保留] 预测标记协议
│   ├── analysis/
│   │   ├── extract-and-update.md    # [新] 合并提取+构造+更新 (替代 construct-proto)
│   │   └── audit-architecture.md    # [增强] 对抗性交叉验证
│   └── user/
│       ├── perception-summary.md
│       └── crystallization-proposal.md
│
├── types/
│   ├── memory.ts                    # SalientElement, ProtoStructure, etc.
│   ├── scene.ts                     # SceneContext (简化)
│   └── hooks.ts                     # Hook 回调类型
│
└── tests/
    ├── statistical-verifier.test.ts  # [新]
    ├── confidence-fuser.test.ts      # [新]
    ├── transcript-analyzer.test.ts   # [新]
    └── integration/
        └── end-to-end.test.ts
```

---

## 二、V7 → V8 模块变化清单

### 删除的模块（4 个纯 token 妥协 + 2 个部分删除）

| 模块 | V7 路径 | 删除原因 | 保留部分 |
|------|--------|---------|---------|
| salience-marker | `orchestration/salience-marker.ts` | token 够用，完整 transcript 交 LLM | — |
| pattern-detector | `analysis/pattern-detector.ts` | PMI 预筛选不必要且造成信息损失 | — |
| **scene-matcher (选择注入)** | `orchestration/scene-matcher.ts` | 全量注入下不需要选择性匹配 | **场景识别 → scene-recognizer.ts** |
| **context-builder (注入策略)** | `orchestration/context-builder.ts` | token 预算约束解除 | **置信度校准 → context-organizer.ts** |
| confidence-updater | `orchestration/confidence-updater.ts` | 替换为 confidence-fuser（多源融合） | — |
| proto-constructor | `analysis/proto-constructor.ts` | 合并到 transcript-analyzer（两步→一步） | — |

### 新增的模块（7 个）

| 模块 | 路径 | 新增原因 |
|------|------|---------|
| scene-recognizer | `orchestration/scene-recognizer.ts` | 场景识别 (从 scene-matcher 保留的认知基础操作) |
| context-organizer | `orchestration/context-organizer.ts` | 层级化组织 + 相关性预排序 + 置信度校准 |
| confidence-fuser | `orchestration/confidence-fuser.ts` | 统计 + LLM + 用户三源融合 |
| transcript-analyzer | `analysis/transcript-analyzer.ts` | 端到端 transcript → 结构化认知 |
| statistical-verifier | `analysis/statistical-verifier.ts` | 独立于 LLM 的验证信号 |
| structure-lifecycle | `analysis/structure-lifecycle.ts` | 长期运行的结构归档/清理/降级 |
| local-cache | `memory/local-cache.ts` | AgentMemory 不可用时的降级 |

### 增强的模块（4 个）

| 模块 | 增强内容 |
|------|---------|
| `hooks/agent-end.ts` | 从"仅 LLM 标记解析"变为"统计验证 + LLM 标记 + 融合" |
| `hooks/session-end.ts` | 从"多步处理"变为"累积 transcript → 一步 LLM 分析" |
| `analysis/degradation-checker.ts` | 从"cron-only"变为"session_end 实时 + cron 深度" |
| `analysis/architecture-auditor.ts` | 从"单一视角 LLM"变为"对抗性 prompt 交叉验证" |

---

## 三、数据流全景（修订）

```
                      ┌─────────────────────────┐
                      │     AgentMemory MCP       │
                      │  + local-cache (降级)     │
                      │                          │
                      │  Slots (不变):            │
                      │  • active_proto_structures│
                      │  • structure_registry     │
                      │  • governance_policy      │
                      │  • pending_crystallizations│
                      │  • architecture_version   │
                      │  • pending_questions      │
                      │                          │
                      │  Memories (不变):         │
                      │  • salient_element        │
                      │  • proto_structure        │
                      │  • cognitive_structure    │
                      │  • structure_evolution    │
                      │  • architecture_audit     │
                      │  • lesson                 │
                      │                          │
                      │  新增:                    │
                      │  • session_transcript     │
                      │    (会话完整 transcript   │
                      │     快照，供累积分析用)    │
                      └──────────┬───────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │  读              │  写               │
              ▼                  ▼                   ▼
┌──────────────────────────────────────────────────────────────┐
│                    Praxis Plugin (V8)                        │
│                                                               │
│  session_start:                                               │
│    1. 全量加载所有结构 (AgentMemory → local-cache 降级)        │
│    2. context-organizer: 层级化组织                           │
│       Layer 1 (前): 场景索引 + 结构摘要                       │
│       Layer 2 (中): 完整 ProtoStructure/CognitiveStructure    │
│       Layer 3 (后): 待验证问题 + 预测标记协议                  │
│    3. 注入系统提示                                            │
│                                                               │
│  message_received:                                            │
│    归档原始消息到 session_transcript_buffer                   │
│    (零分析，零延迟。本模块只剩 3 行代码)                       │
│                                                               │
│  after_tool_call:                                             │
│    追加到 session_tool_trace_buffer:                          │
│    { tool, params_summary, result_summary, timestamp }        │
│                                                               │
│  agent_end:                                                   │
│    1. statistical-verifier.ts:                               │
│       ProtoSequence 预期序列 vs session_tool_trace_buffer     │
│       → 序列对齐 → 统计验证结果 { match_rate, misalignments } │
│    2. prediction-protocol.ts:                                │
│       解析 LLM 输出中的 [PREDICTION_FAILED] 标记              │
│    3. confidence-fuser.ts:                                   │
│       统计信号 (weight: 0.5) + LLM 标记 (weight: 0.5)        │
│       → 融合置信度更新                                        │
│                                                               │
│  session_end:                                                 │
│    1. transcript-analyzer.ts:                                │
│       输入: 本会话 transcript + 前 N 次同场景 transcript      │
│       Prompt: "以下是同一场景的 N 次完整对话。请:              │
│                a. 提取 SalientElement                         │
│                b. 更新 ProtoStructure                         │
│                c. 标记证据来源                                 │
│                d. 生成待验证问题"                              │
│       输出: 结构化 JSON (一步完成)                             │
│    2. degradation-checker.ts: 实时退化检测                    │
│    3. 固化检查 (含自动推进阶梯)                                │
│    4. 持久化所有更新                                          │
└──────────────────────────────────────────────────────────────┘
```

---

## 四、Hook 回调职责（修订）

### 4.1 session_start（重写）

```
session_start(sessionKey, context):

  1. 全量加载:
     ├─ memory_slot_get("active_proto_structures")  ─┐
     ├─ memory_slot_get("structure_registry")         ├─ AgentMemory 不可用 → local-cache 降级
     ├─ memory_slot_get("governance_policy")          │
     └─ memory_slot_get("pending_questions")         ─┘

  2. 场景识别 (scene-recognizer.ts):
     ├─ 从 context 中提取当前会话的场景特征
     ├─ 与已知场景的特征向量计算适配度
     ├─ 确定 scenario_id + 匹配置信度
     ├─ 不用于"选择注入什么"（全量注入），只用于:
     │   • 标记当前场景（Layer 1 中显示）
     │   • 为 session_end 的 transcript 分组提供 scenario_id
     │   • 为 ProtoStructure 关联提供锚点
     └─ 容忍度更高（80% 准确即可——错了不会漏结构）

  3. 上下文组织 (context-organizer.ts):
     ├─ 构建 Layer 1 (~500 tokens):
     │   • 场景索引: "已知场景: 医院门诊(0.85), 政务大厅(0.72), ..."
     │   • 当前场景识别: "当前场景: 医院门诊 (第 8 次交互, 匹配置信度 0.85)"
     │   • 活跃结构摘要: 每个 ProtoStructure 的一句话描述 + 置信度
     │
     ├─ 构建 Layer 2 (按相关性预排序):
     │   Tier A (最前, 完整详情): 当前场景的结构
     │     - 每个结构附带置信度校准指令:
     │       "确定结构 (置信度 0.85)" / "参考模式 (置信度 0.6)" / "试探假设 (置信度 0.3)"
     │     - 完整 ProtoStructure/CognitiveStructure 详情
     │   Tier B (中间, 摘要+引用): 相近场景的结构
     │     - "## 相关场景参考: [政务大厅] 办事流程
     │        该场景也有挂号→等待→办理的序列，但角色定义不同。详情: ..."
     │   Tier C (最后, 仅名称+一句话): 不相关场景的结构
     │     - "- 房产交易 (与该场景基本无关, 仅供参考)"
     │
     └─ 构建 Layer 3 (~500 tokens, 放在用户消息之前):
         • 待验证问题
         • 预测标记协议使用说明

  4. 注入:
     └─ 返回构建好的层级化 prompt 文本
```

### 4.2 message_received（大幅简化）

```
message_received(event, context):

  1. 归档:
     └─ session_transcript_buffer.append({
          role: 'user',
          content: event.message,
          timestamp: Date.now()
        })

  返回: 不修改消息内容（透传）

  代码量: 约 5 行（vs V7 的 ~100 行 regex 逻辑）
```

### 4.3 agent_end（重写）

```
agent_end(runId, result, context):

  1. 统计验证 (statistical-verifier.ts):
     ├─ 获取当前场景的 ProtoSequence 列表
     ├─ 获取 session_tool_trace_buffer
     ├─ 对每个 ProtoSequence:
     │   ├─ 序列对齐 (Levenshtein / fuzzy match)
     │   ├─ 计算匹配率: matched_steps / total_steps
     │   └─ 生成 StatisticalVerificationResult
     └─ 输出: [{ proto_id, match_rate, misalignments, ... }]

  2. LLM 标记解析 (prediction-protocol.ts):
     ├─ 解析 [PREDICTION_FAILED: ...]
     ├─ 解析 [PREDICTION_UNCERTAIN: ...]
     └─ 输出: 同 V7

  3. 置信度融合 (confidence-fuser.ts):
     ├─ 统计信号 + LLM 标记信号 → 融合算法
     ├─ 两者一致 → 正常更新
     ├─ 两者矛盾 → 偏向统计信号（独立源），降低惩罚幅度
     └─ 更新内存中的置信度

  4. 用户纠正处理:
     └─ 同 V7（高权重信号，直接调整置信度）
```

### 4.4 session_end（重写）

```
session_end(sessionKey, context):

  1. 持久化 transcript:
     └─ memory_save(type="session_transcript", data={
          session_key, scenario_id, messages, tool_trace, timestamp
        })

  2. 累积分析 (transcript-analyzer.ts):
     触发条件: 本场景观察次数 >= 2

     ├─ 加载历史 transcript:
     │   └─ memory_smart_search(type="session_transcript",
     │       query=scenario_id, limit=N)

     ├─ 构造分析 prompt (extract-and-update.md 模板):
     │   "以下是同一场景（{scenario_id}）的 {N} 次完整对话记录。
     │    
     │    第 1 次会话: {transcript_1}
     │    第 2 次会话: {transcript_2}
     │    ...
     │    
     │    当前已知的 ProtoStructure:
     │    {existing_proto_structures}
     │    
     │    请完成以下任务:
     │    1. 从每次会话中提取 SalientElement（实体、行为、地点、关系）
     │    2. 跨会话检测模式（序列、角色、概念、目的）
     │    3. 更新现有 ProtoStructure 或创建新的
     │    4. 标记每个结论的证据来源（第几次会话、第几条消息）
     │    5. 生成待验证的问题
     │    
     │    输出格式: JSON (严格遵循 PROTO_STRUCTURE_SCHEMA)"

     ├─ 调用 LLM:
     │   model: claude-sonnet-4-6 (分析任务)
     │   temperature: 0.3
     │   maxTokens: 8000
     │   timeout: config.analysis_budget.llm_timeout_ms (30s)

     └─ 解析输出:
         ├─ 更新 ProtoStructure → memory_slot_replace
         ├─ 保存新的 SalientElement → memory_save
         └─ 记录分析成本 → telemetry

  3. 实时退化检测 (degradation-checker.ts):
     ├─ 检查本会话预测准确率
     ├─ 单次准确率 < 0.3 → 标记 degradation_suspected
     └─ 连续 3 次 < 0.5 → 标记 degradation_confirmed

  4. 固化检查（含自动推进）:
     ├─ 检查手动固化条件 (confidence > 0.8 + observations >= 5)
     ├─ 检查自动固化条件 (confidence > 0.9 + observations >= 10 + 零纠正)
     └─ 生成 CrystallizationProposal 或直接 auto_crystallize

  5. 清理:
     └─ 清空 session buffers
```

---

## 五、数据存储策略（新增）

### 新增 Memory Type

| Type | 内容 | 搜索需求 | 保存时机 |
|------|------|---------|---------|
| `session_transcript` | 会话完整 transcript 快照 + tool trace | 按 scenario_id + 时间范围 | 每次 session_end |

### Slot 设计（与 V7 相同，无变化）

V8 不新增 slot。所有新数据（transcript 快照、统计验证结果）使用 memory type 存储。

---

## 六、兄弟文件

- [What is Praxis V8?](what-is.md) — V8 的工程定义
- [Why Praxis V8?](why.md) — 第一性原理：为什么 1M 上下文改变了架构
- [Who is it for?](who.md) — 角色职责的变化
- [How does it work?](how.md) — 层级化组织、统计验证、双信号融合
- [When does it operate?](when.md) — 简化的实现路线图
- [Architecture Design](design.md) — 技术规格与 API 契约
