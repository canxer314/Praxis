# What is AgentOS V2?

> **一句话**：AgentOS V2 是运行在 OpenClaw 内部的一个 memory plugin，它把 AI 的工具使用经验转化为可量化、可累积、可跨会话传递的能力模型。

## V2 的本质变化

V1 中 AgentOS 被设想为一个独立的 Harness 层中间件，需要自建完整的 agent runtime（Hook 系统、工具执行、通道管理）。

V2 重新审视后确认：**AgentOS 的核心价值是学习闭环 + 能力模型 + 自主决策**。工具执行、通道通信、agent loop 是"身体"的职责——这恰好是 OpenClaw 已经做好的事。

因此 V2 的架构从"自建 Harness + 集成身体"变为"**占据 OpenClaw 的 Memory Plugin 槽位**"。

## AgentOS V2 是什么

| ✅ 是 | ❌ 不是 |
|------|--------|
| 一个 **OpenClaw Memory Plugin** | 一个独立的 agent runtime |
| 一个**跨工具能力追踪**系统 | 工具本身 |
| 一个**学习闭环引擎**（在 Hook 上运行） | 一个调度器 |
| 一个与 **AgentMemory 深度集成**的知识/经验管理后端 | 替代 OpenClaw 的任何核心功能 |
| 一个让 OpenClaw **从"会用工具"变成"越用越会"**的升级 | 一个需要修改 OpenClaw 核心的 fork |

## V1 → V2 的关键变化

| V1 | V2 |
|----|----|
| 自建 Harness（Hook + Commands + System Prompt 注入） | Hook 逻辑移动到 OpenClaw Plugin 的生命周期钩子中 |
| 工具注册在 AgentOS 内部 | 工具注册 = OpenClaw 的工具生态 + AgentOS 附加 proficiency/feedback 元数据 |
| `/agentos` 命令是 Claude Code Skills | `/agentos` 命令是 OpenClaw Plugin 暴露的 slash commands |
| 架构中是"顶层"（在 LLM 和世界之间） | 架构中是"内嵌层"（在 OpenClaw 的 memory slot 中） |

## 核心概念（不变）

```
你不是在"配置一个 AI 的性格"。
你是在"培养一个 AI 的能力"。

它的"自我"不是写出来的——是做出来的。
```

### "越用越像它自己"

> 随着使用，AI 的能力集合从"空"（只有通用知识）逐渐填充为"有专长"（在用户需要的领域有可证明的熟练度）。
> 这个**能力集合 × 熟练度 × 协作历史 × 用户偏好 = AI 的"自我"**。

## 一个具体例子（更新）

**场景**：你通过 OpenClaw 的 Telegram 网关给 AI 发消息，让它用接入的咖啡机冲咖啡。

```
第 1 次：你一步步在 Telegram 里教它怎么冲。AgentOS 记录你的参数偏好到 AgentMemory。

第 3 次：它在 Telegram 上说"我帮你冲咖啡"。OpenClaw 调用 coffee_machine MCP 工具。
         AgentOS 的 before_tool_call hook 检查到 coffee_machine proficiency=0.35，
         决定需要确认："准备用 85°C 冲深烘焙，200ml，可以吗？"
         它忘记检查水量——失败了。after_tool_call 检测到 out_of_water 信号，
         AgentOS 生成 LearningEvent: "冲之前必须检查 status()"。

第 10 次：coffee_machine proficiency=0.65，before_tool_call 判断可以自主执行。
         你在忙——它冲好咖啡，在 Telegram 上说"咖啡好了"。

第 50 次：它注意到你周一早上和周五下午的口味偏好不同，
         自动调整参数。你不再需要说任何话。
         这一切发生在 OpenClaw 的 agent loop 内部，
         AgentOS 在 memory plugin slot 中默默记录每一次的 improvement。
```

**V2 的关键点**：用户通过 OpenClaw 的原生通道（Telegram/Discord/WhatsApp/...）与 AI 交互，OpenClaw 执行工具，AgentOS 在背后追踪一切并让下一次更好。用户不需要知道 AgentOS 的存在——就像你不需要知道大脑的杏仁核在做什么。

## 兄弟文件

- [Why AgentOS V2?](why.md) — 为什么是这个组合
- [Who is it for?](who.md) — 谁在使用？
- [How does it work?](how.md) — AgentOS Plugin 架构详解
- [When does it operate?](when.md) — Hook 触发点和生命周期
- [Where does it sit?](where.md) — 架构定位与系统关系
- [Architecture Design](design.md) — V2 集成架构设计文档
