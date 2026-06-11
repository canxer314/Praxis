# When does AgentOS V3 operate?

## V3 触发模型：被动 Hook + 主动检测

V2 的触发完全是 Hook 驱动的（5 个 Hook）。V3 扩展为**6 个 Hook + Curiosity Engine 主动扫描**。

```
触发类型          触发点                           V2    V3
─────────────────────────────────────────────────────────
Hook (被动)      session_start                    ✅    ✅
Hook (被动)      message_received                 ❌    ✅  ← 新增
Hook (被动)      before_tool_call                 ✅    ✅
Hook (被动)      after_tool_call                  ✅    ✅
Hook (被动)      agent_end                        ✅    ✅（扩展）
Hook (被动)      session_end                      ✅    ✅（扩展）
主动检测          Curiosity Engine 缺口扫描        ❌    ✅  ← 新增
主动检测          定期 cron 知识审计               ❌    ✅  ← 新增
用户命令          /agentos *                      ✅    ✅（扩展）
```

---

## 完整生命周期（V3）

```
┌────────────────────────────────────────────────────────────┐
│                  AgentOS V3 Lifecycle                        │
│                                                              │
│  OPENCLAW SESSION START ──────────────────────────────────▶ │
│    │                                                         │
│    ├─ [Hook: session_start]                                  │
│    │   ├─ 加载四维能力模型 (memory_slot_get ×4)              │
│    │   ├─ 加载用户模型 (memory_slot_get "user_model")        │
│    │   ├─ 加载待处理知识缺口列表                              │
│    │   ├─ memory_smart_search("mental_state", 3)             │
│    │   └─ 注入 AgentOS Context 到 OpenClaw system prompt     │
│    │                                                         │
│    │   ┌─── WORK PHASE ────────────────────────────────┐    │
│    │   │                                                │    │
│    │   │  [Hook: message_received]  ← V3 新增           │    │
│    │   │  ├─ 分析消息语义意图                            │    │
│    │   │  │   ├─ 教导模式 → 提取领域知识                │    │
│    │   │  │   ├─ 纠正模式 → 更新用户偏好                │    │
│    │   │  │   ├─ 评价模式 → 关联到任务/步骤             │    │
│    │   │  │   └─ 普通消息 → 检测未知术语→标记缺口      │    │
│    │   │  └─ 暂存 LearningEvent (type: domain_insight    │    │
│    │   │                        / preference_discovery)  │    │
│    │   │                                                │    │
│    │   │  [Hook: before_tool_call]                      │    │
│    │   │  ├─ 解析 tool_id + action                      │    │
│    │   │  ├─ 查询四维能力:                               │    │
│    │   │  │   ├─ tool_skills[tool_id].proficiency       │    │
│    │   │  │   ├─ domain_familiarity[相关领域]           │    │
│    │   │  │   └─ user_model (偏好注入)                  │    │
│    │   │  ├─ 注入相关知识（五类知识检索）                │    │
│    │   │  └─ 决定自主性级别                              │    │
│    │   │                                                │    │
│    │   │  [OpenClaw executes tool]                      │    │
│    │   │                                                │    │
│    │   │  [Hook: after_tool_call]                       │    │
│    │   │  ├─ 评估执行结果 vs 期望                        │    │
│    │   │  ├─ 匹配成功/失败信号                           │    │
│    │   │  ├─ 检测新模式 vs 已知模式                      │    │
│    │   │  └─ 暂存 LearningEvent (type: mistake_correction│    │
│    │   │                        / procedural_optimization)│   │
│    │   │                                                │    │
│    │   │  [重复 message → before → execute → after]     │    │
│    │   └────────────────────────────────────────────────┘    │
│    │                                                         │
│    │  [Hook: agent_end] ← V3 扩展                            │
│    │  ├─ 工具级处理（V2 原有）:                               │
│    │  │   ├─ 汇总所有 pending_learning_events                 │
│    │  │   ├─ 计算 proficiency delta                          │
│    │  │   ├─ memory_lesson_save(LearningEvent)               │
│    │  │   └─ 更新 tool_skills                                │
│    │  │                                                      │
│    │  └─ 任务级反思（V3 新增）:                               │
│    │      ├─ 评估任务整体结果 vs 目标                         │
│    │      ├─ 识别工具链 → 匹配已知 TaskPattern               │
│    │      │   → 匹配 → 更新 pattern                          │
│    │      │   → 不匹配 → 候选新 pattern                      │
│    │      ├─ 评估涉及的领域 → 更新 domain_familiarity        │
│    │      └─ 检测用户反馈语义 → 更新 user_model              │
│    │                                                         │
│    │  [Curiosity Engine 扫描] ← V3 新增                      │
│    │  ├─ 阶段 1: 缺口检测                                    │
│    │  │   ├─ 扫描任务中出现的未知术语                         │
│    │  │   ├─ 交叉检查知识图谱                                 │
│    │  │   └─ 输出: new + updated KnowledgeGap[]              │
│    │  ├─ 阶段 2: 缺口排序                                    │
│    │  │   └─ 关联度 × 频率 × 影响 → priority                 │
│    │  ├─ 阶段 3: 行动生成                                    │
│    │  │   └─ 按 priority 决定: 静默 | 检索 | 提问草稿 | 立即提问│
│    │  └─ 阶段 4: 提问治理                                    │
│    │      ├─ 如果决定提问:                                    │
│    │      │   ├─ 检查 frequency limit                        │
│    │      │   ├─ 检查 quiet_hours                            │
│    │      │   ├─ 格式化问题（带上下文）                       │
│    │      │   └─ 通过 OpenClaw message_sending 发送           │
│    │      └─ 如果不提问:                                      │
│    │          └─ 标记 gap 状态为 "open"，等待下次评估         │
│    │                                                         │
│  OPENCLAW SESSION END ────────────────────────────────────▶ │
│    │                                                         │
│    └─ [Hook: session_end]                                    │
│        ├─ 生成本次会话成长总结（四维）                        │
│        ├─ memory_patterns() → 行为模式 + 任务模式             │
│        ├─ Curiosity Engine 最终扫描                           │
│        │   └─ 汇总所有待处理的 knowledge_gaps                │
│        ├─ 生成演化提案（如有显著能力变化）                    │
│        └─ memory_save(type="mental_state", 本轮反思)         │
└────────────────────────────────────────────────────────────┘
```

---

## 新增 Hook 详解

### message_received（V3 新增，第 6 个核心 Hook）

```
触发: 每次用户通过 OpenClaw 通道发送消息时
事件: { from, content, timestamp, sessionKey, ... }

AgentOS 处理逻辑:

1. 语义意图分类:
   ┌─────────────────────────────────────────────────┐
   │ 消息内容                            意图分类     │
   ├─────────────────────────────────────────────────┤
   │ "让我解释一下我们的采购流程..."      教导模式     │
   │ "不对，重点是风险分析不是数据展示"    纠正模式     │
   │ "下次直接发邮件就行，别问我"          偏好表达     │
   │ "这次的分析比上次有深度"             任务评价     │
   │ "帮我做膜力云的周报"                 任务分配     │
   │ (消息中反复出现知识库中不存在的术语)  缺口信号     │
   └─────────────────────────────────────────────────┘

2. 教导模式 → 提取:
   ├─ 主题 (topic)
   ├─ 关键概念 (concepts)
   ├─ 与已知领域的关系
   └─ 生成 LearningEvent { type: "domain_insight" }

3. 纠正模式 → 定位:
   ├─ 被纠正的是哪个知识/行为？
   ├─ 纠正的具体内容是什么？
   └─ 生成 LearningEvent { type: "preference_discovery" }

4. 偏好表达 → 更新:
   └─ user_model 对应维度

5. 任务评价 → 关联:
   ├─ 关联到最近的 agent_end 任务
   ├─ 提取具体评价维度（哪些好/哪些不好）
   └─ 更新对应维度的 proficiency

6. 缺口信号 → 标记:
   └─ 创建/更新 KnowledgeGap
```

---

## Curiosity Engine 主动检测时机

### 在 agent_end 时（每次任务完成后）

- **触发条件**：agent_end hook 触发
- **扫描范围**：当前 agent 的所有 tool_calls + 用户消息
- **输出**：new/updated KnowledgeGap[]
- **是否提问**：仅当 priority > 0.8 且当前任务被阻塞时

### 在 session_end 时（每次会话结束时）

- **触发条件**：session_end hook 触发
- **扫描范围**：整个会话的所有 agent_end 积累 + 跨会话对比
- **输出**：综合 KnowledgeGap 报告 + 提问建议
- **是否提问**：通过——提问在会话结束时不发送，而是在下次合适时机发送

### 定期 cron（后台审计）

- **触发条件**：OpenClaw cron job（如每周一次）
- **扫描范围**：所有 active KnowledgeGap + 能力模型 + 知识图谱
- **输出**：能力缺口审计报告
- **是否提问**：不直接提问——生成报告，等用户主动查看或下一个会话开始时提示

---

## 提问时机治理

AgentOS 主动提问必须遵守以下时机规则：

| 规则 | 说明 |
|------|------|
| **频率限制** | 每天最多 `curiosity.max_questions_per_day` 次（默认 3） |
| **静默时段** | `curiosity.quiet_hours`（默认 22:00-08:00）内不提问 |
| **用户忙检测** | 用户刚发完消息 1 分钟内不提问（等对话自然结束） |
| **批量合并** | 如果有多个待问缺口 → 合并为一条消息（而非刷屏） |
| **上下文携带** | 每条提问必须包含：为什么问这个 + 在哪里遇到的 + 我尝试了什么 |
| **可关闭** | 用户回复"以后别问了" → 该缺口降级为静默；回复"都别问了" → Level 降为 0 |
| **首次确认** | Level 0→2 的升级必须用户手动确认 |

### 提问消息格式规范

```
(AgentOS 主动提问的 Telegram 消息模板)

📚 我有个问题（今天第 1/3 个）

在做本周的膜力云周报时，我注意到每次数据采集阶段都需要理解三个系统的关系。

关于「膜力云数据源架构」：
→ 城乡数据平台的数据是 API 实时同步的吗？还是定时推送？
→ 智慧水务的数据和制造管理的数据在什么环节汇总？

我试着查了之前的会议记录和代码注释，但没找到明确的说明。
方便的时候指点一下就好，不急 🙏
```

---

## 错误恢复（V3 新增场景）

| 场景 | 处理 |
|------|------|
| Curiosity Engine 提问后用户忽略 | 3 天后自动降级该缺口 priority；7 天后标记为 "stale" |
| 用户拒绝回答某个问题 | 该缺口 priority 永久降低 0.3 |
| 用户表达不满（"别烦我"） | 立即降级 Curiosity Level；该会话内不再提问 |
| AgentMemory 连接断开 | Curiosity Engine 暂缓，恢复后批量处理 |
| 提问与用户当前消息冲突 | 提问进入待发队列，等对话自然停顿后发送 |

---

## 用户命令（V3 新增）

| 命令 | 功能 | V2 | V3 |
|------|------|----|----|
| `/agentos status` | 查看四维能力雷达图 | ✅ | ✅（扩展） |
| `/agentos tools` | 工具熟练度 | ✅ | ✅ |
| `/agentos teach <topic>` | 主动教导 | ✅ | ✅ |
| `/agentos gaps` | 查看知识缺口列表 | ❌ | ✅ 新增 |
| `/agentos gaps answer <id>` | 回答某个知识缺口 | ❌ | ✅ 新增 |
| `/agentos curiosity level` | 查看/设置主动学习级别 | ❌ | ✅ 新增 |
| `/agentos curiosity off` | 关闭主动提问 | ❌ | ✅ 新增 |
| `/agentos domains` | 查看领域知识掌握度 | ❌ | ✅ 新增 |
| `/agentos patterns` | 查看已识别的任务模式 | ❌ | ✅ 新增 |

---

## 后台定期任务（V3 更新）

| 周期 | 任务 | V2 | V3 |
|------|------|----|----|
| 每次 agent_end | 学习事件批量写入 | ✅ | ✅ |
| 每次 agent_end | 任务级反思 | ❌ | ✅ |
| 每次 agent_end | Curiosity Engine 扫描 | ❌ | ✅ |
| 每次 session_end | 技能评估校准 | ✅ | ✅（四维） |
| 每次 session_end | 知识缺口审计 | ❌ | ✅ |
| 每天 | 知识固化 | ✅ | ✅ |
| 每周 | 能力缺口分析（cron） | ✅ | ✅（新增领域维度） |
| 每周 | 未填充缺口重排序（cron） | ❌ | ✅ |
| 每月 | 能力模型审计 | ✅ | ✅（四维） |

---

## 兄弟文件

- [What is AgentOS V3?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？
- [Why AgentOS V3?](why.md) — 为什么需要 V3
- [How does it work?](how.md) — 六层架构 + Curiosity Engine
- [Where does it sit?](where.md) — 架构定位
- [Architecture Design](design.md) — V3 架构设计文档
