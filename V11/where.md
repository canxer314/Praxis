# Where does AgentOS V11 sit?

> V11 在 V10 基础上的扩展：5 个新模块、1 个新 slot、7 个模块微调。新增 `api/` 目录（知识查询端点）和 `analysis/proto-task.ts`（从 V10 Phase 2+ 拉入 Phase 1）。

---

## 一、完整模块树

```
openclaw/src/plugins/agentos-plugin/
├── index.ts
├── config.ts                              # [增强] +4 个新配置段
│
├── api/                                   # [新 V11] 对外查询接口
│   └── knowledge-query.ts                 # [新] 知识查询端点
│
├── hooks/
│   ├── session-start.ts                  # [修改] +GuidanceSignal 注入 + 知识查询调用
│   ├── message-received.ts               # [修改] +detectUserCorrection 调用
│   ├── before-tool-call.ts               # [修改] +detectToolPatternViolation 调用
│   ├── after-tool-call.ts                # 同 V10
│   ├── agent-end.ts                      # 同 V10
│   └── session-end.ts                    # [修改] +outcome 加权置信度更新
│
├── orchestration/
│   ├── context-pressure-monitor.ts       # 同 V9
│   ├── scene-recognizer.ts               # 同 V9
│   ├── context-organizer.ts              # 同 V10 (任务感知排序)
│   ├── cognitive-guidance.ts             # [新] 认知指导信号生成
│   ├── task-context.ts                   # [修改] +outcome 处理集成
│   ├── confidence-fuser.ts               # [修改] +outcome + mid_session 信号源
│   └── prediction-protocol.ts            # 同 V9
│
├── analysis/
│   ├── transcript-analyzer.ts            # [修改] +outcome-weighted 分析
│   ├── proto-task.ts                     # [新] ProtoTask 构造 (Phase 1 核心)
│   ├── outcome-feedback.ts               # [新] 任务结果反馈处理
│   ├── mid-session-learner.ts            # [新] 会话中实时矛盾检测
│   ├── statistical-verifier.ts           # 同 V9
│   ├── role-verifier.ts                  # 同 V9
│   ├── concept-verifier.ts               # 同 V9
│   ├── attention-telemetry.ts            # 同 V9
│   ├── consistency-checker.ts            # 同 V9
│   ├── config-adapter.ts                 # 同 V9
│   ├── degradation-checker.ts            # 同 V9
│   ├── structure-lifecycle.ts            # 同 V9
│   └── architecture-auditor.ts           # 同 V9
│
├── memory/
│   ├── client.ts
│   ├── recall-structure.ts
│   ├── local-cache.ts
│   ├── schemas.ts                        # [增强] +GuidanceSignal + SubtaskOutcome + ProtoTask
│   ├── slots.ts                          # [增强] +proto_task slot
│   └── queries.ts                        # [增强] +outcome + proto_task 查询
│
├── prompts/
│   ├── system/
│   │   ├── memory-context.md             # [修改] +认知指导信号注入格式
│   │   ├── prediction-markers.md
│   │   └── critical-mode.md
│   ├── analysis/
│   │   ├── extract-and-update.md         # [修改] +outcome-weighted 分析指令
│   │   ├── construct-proto-task.md       # [增强] +bootstrap 模式
│   │   ├── consistency-scan.md
│   │   └── audit-architecture.md
│   └── user/
│       ├── perception-summary.md
│       └── crystallization-proposal.md
│
├── types/
│   ├── memory.ts                         # [增强] +GuidanceSignal + MidSessionContradiction + SubtaskOutcome
│   ├── scene.ts                          # [增强] +KnowledgeQuery + KnowledgeQueryResult
│   └── hooks.ts                          # [增强] +GuidanceSignal 上下文传递
│
└── tests/
    ├── cognitive-guidance.test.ts         # [新]
    ├── outcome-feedback.test.ts           # [新]
    ├── mid-session-learner.test.ts        # [新]
    ├── knowledge-query.test.ts            # [新]
    └── proto-task.test.ts                # [增强] +bootstrap 测试
```

---

## 二、V10 → V11 模块变化清单

### 新增模块（5 个）

| 模块 | 路径 | 职责 | 接口 |
|------|------|------|------|
| knowledge-query | `api/knowledge-query.ts` | 知识查询端点 | 接口 1 |
| cognitive-guidance | `orchestration/cognitive-guidance.ts` | 认知指导信号生成 | 接口 2 |
| outcome-feedback | `analysis/outcome-feedback.ts` | 任务结果反馈处理 | 接口 3 |
| mid-session-learner | `analysis/mid-session-learner.ts` | 实时矛盾检测 + 即时调整 | 接口 4 |
| proto-task | `analysis/proto-task.ts` | ProtoTask 构造 (含 bootstrap) | 核心 |

### 修改模块（7 个）

| 模块 | 改动量 | 说明 |
|------|--------|------|
| `hooks/session-start.ts` | ~20 行 | +generateGuidanceSignals() + queryKnowledge() + 注入格式调整 |
| `hooks/message-received.ts` | ~10 行 | +detectUserCorrection() 调用 + 即时调整 |
| `hooks/before-tool-call.ts` | ~10 行 | +detectToolPatternViolation() 调用 + 即时调整 |
| `hooks/session-end.ts` | ~15 行 | +processOutcomeFeedback() + outcome-weighted 置信度更新 |
| `orchestration/task-context.ts` | ~10 行 | +receiveSubtaskOutcome() + 关联 task_history |
| `orchestration/confidence-fuser.ts` | ~10 行 | +outcome 信号源 + mid_session 信号源 |
| `analysis/transcript-analyzer.ts` | ~10 行 | +outcome-weighted 分析 prompt 调整 |

### 新增 AgentMemory Slot / Type

```
# proto_task slot (V11 核心)
# 存储: 当前 task_type 的 ProtoTask 结构
# 大小: < 5KB
# 格式: ProtoTask JSON
memory_slot_get: "proto_task"         # session_start 读取
memory_slot_set: "proto_task"         # ProtoTask 构造/更新时写入

# task_outcomes (memory type, 非 slot)
# 存储: SubtaskOutcome 记录
# 查询: memory_smart_search(subtask_name, task_id)
# 保存时机: 子任务完成时

# guidance_signals (memory type, 非 slot)
# 存储: 历史 GuidanceSignal 记录
# 查询: memory_smart_search(signal_type, session_id)
# 用途: 分析指导效果（采纳率统计）
```

---

## 三、数据流（V11 增强）

```
session_start (V11 增强):
  1. 全量加载结构到内存
  2. 场景识别
  3. 加载 TaskContext
  4. 【新 V11】加载 ProtoTask:
     └─ memory_slot_get("proto_task")
     └─ 如不存在 + task_type 有值 → bootstrapProtoTask()
  5. 上下文压力测量
  6. 自适应注入:
     Layer 1:
       + "## ⚠ 认知指导 [V11]"
       + GuidanceSignal 列表 (max 5, ~100 tokens)
     Layer 2 (任务感知优先级 + 认知指导):
       Tier A = 当前场景 + TaskContext.relevant_scenarios 的结构
       + 【新 V11】GuidanceSignal 中的 structure_recommendation 优先
       排序权重 = 场景匹配度 × 0.55 + 任务相关性 × 0.35 + 信号推荐 × 0.10

message_received (V11 增强):
  1. (同 V10)
  2. 【新 V11】detectUserCorrection(message, activeProtoStructures)
     → MidSessionContradiction[] → applyImmediateConfidenceAdjustment()
     → 即时更新内存中的 ProtoStructure 置信度
  3. (同 V10)

before_tool_call (V11 增强):
  1. (同 V10)
  2. 【新 V11】detectToolPatternViolation(toolCall, activeProtoSequences)
     → 累计违反计数 → 超过 threshold → applyImmediateConfidenceAdjustment()
     → 即时更新内存中的 ProtoStructure 置信度
  3. (同 V10)

session_end (V11 增强):
  1-6. (同 V10)
  7. TaskContext 自动更新 (同 V10)
  8. 【新 V11】processOutcomeFeedback():
     └─ 从 AgentMemory 读取 session 中积累的 SubtaskOutcome[]
     └─ 对每个 outcome，调整关联 ProtoStructure 置信度
     └─ 更新 ProtoTask (阶段时长修正、陷阱命中率)
     └─ 持久化调整后的结构

子 Agent session_start (V11 增强):
  子 Agent session_start hook:
    → 父 Agent 的 TaskContext + ProtoTask + GuidanceSignal
    → 注入子 Agent 的系统提示
    → 子 Agent 获得完整的认知上下文和认知指导
    → 子 Agent 的 tool calls 受 mid-session-learner 监控
    → 子 Agent 结束 → SubtaskOutcome 反馈 → 父 Agent 的 ProtoStructure 更新

知识查询（新 V11 数据流）:
  planning-with-files 调用:
    → queryKnowledge({query_type: "proto_task", task_type: "software_project"})
    → AgentOS 从 memory_slot_get("proto_task") 读取
    → 如无 → bootstrapProtoTask() 生成
    → 返回 KnowledgeQueryResult (含 ProtoTask + 置信度 + 来源标记)
    → planning-with-files 将结果纳入任务计划文件
```

---

## 四、接口时序图

```
planning-with-files          AgentOS               OpenClaw/LLM
      │                         │                      │
      │──queryKnowledge()──────→│                      │
      │←──ProtoTask template───│                      │
      │                         │                      │
      │   (创建任务计划文件)     │                      │
      │                         │                      │
      │                         │──session_start─────→│
      │                         │  (注入 TaskContext   │
      │                         │   + GuidanceSignal   │
      │                         │   + ProtoStructures) │
      │                         │                      │
      │                         │                      │──用户消息──→
      │                         │←──message_received───│
      │                         │  (detectUserCorrection)
      │                         │  → 即时调整置信度    │
      │                         │                      │
      │                         │←──before_tool_call───│
      │                         │  (detectToolViolation)
      │                         │  → 即时调整置信度    │
      │                         │                      │
      │                         │                      │──子任务完成─→
      │                         │←──SubtaskOutcome────│
      │                         │  (processOutcomeFeedback)
      │                         │  → 置信度 + ProtoTask 更新
      │                         │                      │
      │                         │──session_end───────→│
      │                         │  (outcome-weighted 分析)
```

---

## 五、兄弟文件

- [What is AgentOS V11?](what-is.md) — V11 的工程定义
- [Why AgentOS V11?](why.md) — 第一性原理：为什么需要知行合一闭环
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 四个接口的完整实现
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Architecture Design](design.md) — 技术规格与 API 契约
