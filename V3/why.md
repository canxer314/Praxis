# Why AgentOS V3?

> V2 解决了"用什么承载学习闭环"的问题。V3 解决"学习到底学什么、谁来发起"的问题。

---

## 一、根本问题回顾（V1 → V2 → V3 一以贯之）

**无状态的 LLM 每次会话都是从零开始。**

V1 诊断了这个问题，V2 找到了正确的载体（OpenClaw + AgentMemory），但 V2 对"学习"的定义过于狭窄——它把学习简化为"工具调用的成功/失败反馈"。

V3 追问一个更深的问题：**一个大学毕业生在工作中成长的本质是什么？**

---

## 二、V2 的缺口：5 Whys 分析

### 缺口一：只有工具熟练度，没有业务知识

**观察**：V2 的能力模型是 `{tool_id → proficiency}` 的映射。做了 100 次周报，AgentOS 只知道"会用 PPT 工具"，不知道"周报里应该包含什么"。

**Why 1**：为什么 V2 没有建模业务知识？
→ 因为 V2 的学习信号全部来自工具调用（`after_tool_call`），而业务知识的信号来自对话内容（用户在说什么）。

**Why 2**：为什么不用对话内容作为学习信号？
→ 因为 V2 没有使用 `message_received` hook。

**Why 3**：为什么没使用？
→ 因为 V2 的设计以"架构适配"为优先级，关注的是怎么把六层映射到 OpenClaw，而不是在 OpenClaw 环境里学习到底应该学什么。

**Why 4**：为什么架构适配优先于学习完整性？
→ [假设] 因为迁移时潜意识里把 V1 的设计当作"正确的模板"，而非"需要被重新审视的初稿"。

**Why 5**：为什么 V1 的设计本身就偏向工具？
→ 因为 V1 是独立 Harness，它的运行环境是 Claude Code——一个以工具执行为核心的 agent loop。在那个环境里，工具调用是最自然的锚点。但迁移到 OpenClaw 后，消息通道（Telegram 等）提供了更丰富的学习信号来源，这个约束已经消失了。

### 缺口二：没有主动学习能力

**观察**：V2 的所有学习都是被动的——Hook 触发 → AgentOS 响应。它永远不会主动说"我不懂这个，能教我吗？"

**Why 1**：为什么需要被动？
→ 因为 V2 的学习引擎是一个纯事件驱动的回调集合。

**Why 2**：为什么没有内部驱动的检测循环？
→ 因为设计中没有一个子系统负责"审视自己知道什么、不知道什么"。

**Why 3**：为什么没有这个子系统？
→ [假设] 因为 V1/V2 的设计隐含假设是"用户会主动教导 AI"（通过 `/agentos teach` 或反馈），而非"AI 应该主动发现自己的无知"。

**Why 4**：为什么有这个假设？
→ 因为 V1 的原始用户画像是"Mentor"——一个愿意花时间培养 AI 的人。但实际上，Mentor 也会累，最好的 Mentor 希望 AI 能**自己发现问题然后带着具体问题来问**，而不是等着 Mentor 发现 AI 哪里不懂。

**Why 5**：真正优秀的毕业生是怎样的？
→ 不可否认的事实：好的新人不是等师父喂饭——他们自己查、自己试、碰到真过不去的坎才问。而且问的时候是有上下文的："我试着做了 X，卡在 Y 这里，我查了 Z 但没解决，能指点一下吗？"

---

## 三、V2 → V3 的变化

### 变化一：学习对象从一维到四维

```
V2:  tool_id ──→ proficiency (0.0-1.0)

V3:  ┌─ tool_skills:         {coffee_machine: 0.72, ppt_generator: 0.55, ...}
     ├─ domain_familiarity:  {"膜力云项目": 0.45, "城乡数据平台": 0.60, ...}
     ├─ task_type_proficiency: {"progress_report": 0.58, "stakeholder_comm": 0.35, ...}
     └─ user_model_confidence: {communication: 0.70, decisions: 0.40, context: 0.55}
```

### 变化二：学习引擎从被动到主动

```
V2:  Hook → AgentOS 响应 → 更新模型

V3:  Hook → AgentOS 响应 → 更新模型
      +
      Curiosity Engine 定期扫描 → 检测知识缺口 → 排序 → 提问/自学
```

### 变化三：知识分类从无结构到五维

```
V2:  memory_save(type="knowledge", ...)  // 所有知识混在一起

V3:  memory_save(type="domain_knowledge", ...)     // 领域知识
     memory_save(type="task_pattern", ...)          // 任务模式
     memory_save(type="user_model", ...)            // 用户模型
     memory_save(type="procedural_knowledge", ...)  // 流程知识
     memory_save(type="tool_knowledge", ...)         // 工具知识（V2 原有的）
```

### 变化四：学习事件从 1 种到 5 种

```
V2:  LearningEvent { type: "mistake_correction" }

V3:  + domain_insight         // "用户教我膜力云项目的三个阶段"
     + preference_discovery   // "用户偏好图表优先于表格"
     + task_pattern_recognition // "周报=数据→图表→PPT→发送"
     + procedural_optimization  // "先确认数据新鲜度再做报告"
     + mistake_correction       // V2 原有
```

---

## 四、反向论证

**反方论点**："AgentOS 是中间件，不是 AI——学习主动性应该留给上层（OpenClaw Agent Loop），AgentOS 只需管理好数据和 Hook。"

**这个论点为什么不对**：

1. **如果 AgentOS 只管理数据** — 它和普通数据库没有本质区别。它的核心价值主张就是"让 AI 成长"——成长必须有主体性。
2. **OpenClaw Agent Loop 是无状态的** — 它每次会话从 system prompt 获得上下文。它没有"我上次不懂什么"的跨会话记忆，这正是 AgentOS 存在的理由。
3. **差距检测需要跨会话的全局视角** — 单次会话中看不出"这个概念我反复遇到但始终不理解"——只有 AgentOS 的持久存储能提供这个视角。
4. **但治理机制必须极度保守** — AI 主动提问的频率、时机、措辞需要精细控制，不能让用户觉得烦。这正是 V3 设计 Curiosity Governance 的原因。

**什么条件会改变结论？**
- 如果 OpenClaw Agent Loop 本身具备了跨会话状态管理能力 → AgentOS 的 Curiosity Engine 应该上移到 Agent Loop 层
- 如果用户明确表示"永远不要主动联系我" → Curiosity Engine 降级为被动模式（Level 0）

---

## 兄弟文件

- [What is AgentOS V3?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？角色反转
- [How does it work?](how.md) — 六层架构 + Curiosity Engine
- [When does it operate?](when.md) — 完整生命周期
- [Where does it sit?](where.md) — 架构定位
- [Architecture Design](design.md) — V3 架构设计文档
