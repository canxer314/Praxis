# When does Praxis V2 operate?

## V2 触发模型：Hook-Driven Lifecycle

V1 中 Praxis 在 Claude Code 的 Harness Hook 上运行。V2 中触发点全部迁移到 OpenClaw 的 Plugin Hook System。

### OpenClaw Hook 映射

OpenClaw 提供 25+ 个 plugin hook。Praxis 使用其中 5 个核心 hook：

```
OpenClaw Hook              Praxis 动作                      V1 对应
─────────────────────────────────────────────────────────────────────
session_start             加载能力模型 + 注入上下文          SessionStart Hook
before_tool_call          查询自主性策略 + 注入已知陷阱       PostToolUse (pre)
after_tool_call           收集执行反馈 + 暂存学习事件         PostToolUse (post)
agent_end                 执行学习闭环 + 更新能力模型          SessionEnd (partial)
session_end               会话反思 + 保存 mental_state        SessionEnd (partial)
```

---

## 完整生命周期

```
┌────────────────────────────────────────────────────────────┐
│                  Praxis V2 Lifecycle                        │
│  (All trigger points are OpenClaw Plugin Hooks)             │
│                                                              │
│  OPENCLAW SESSION START ──────────────────────────────────▶ │
│    │                                                         │
│    ├─ [Hook: session_start]                                  │
│    │   ├─ memory_slot_get("competency_model")                │
│    │   ├─ memory_slot_get("autonomy_policy")                 │
│    │   ├─ memory_slot_get("tool_registry")                   │
│    │   ├─ memory_smart_search("mental_state", limit=3)       │
│    │   └─ 注入 Praxis Context 到 OpenClaw system prompt     │
│    │                                                         │
│    │   ┌─── WORK PHASE (OpenClaw Agent Loop) ──────────┐    │
│    │   │                                                │    │
│    │   │  [Hook: before_tool_call]                      │    │
│    │   │  ├─ 解析 tool_id + action                      │    │
│    │   │  ├─ 查询 skill proficiency                     │    │
│    │   │  ├─ 查询 known_failure_modes                   │    │
│    │   │  ├─ 查询 user_preferences                      │    │
│    │   │  └─ 决定自主性级别:                            │    │
│    │   │      • 熟练+低风险 → 自主执行                   │    │
│    │   │      • 熟练+高风险 → 执行但告知                 │    │
│    │   │      • 不熟练+低风险 → 确认后执行               │    │
│    │   │      • 不熟练+高风险 → 必须确认                 │    │
│    │   │      • 发生过错误 → 降级一级                    │    │
│    │   │                                                │    │
│    │   │  [OpenClaw executes tool]                      │    │
│    │   │                                                │    │
│    │   │  [Hook: after_tool_call]                       │    │
│    │   │  ├─ 评估执行结果 vs 期望                        │    │
│    │   │  ├─ 匹配成功/失败信号                           │    │
│    │   │  ├─ 检测新模式 vs 已知模式                      │    │
│    │   │  └─ 暂存 pending_learning_event                │    │
│    │   │                                                │    │
│    │   │  [重复 before → execute → after]               │    │
│    │   └────────────────────────────────────────────────┘    │
│    │                                                         │
│    │  [Hook: agent_end]                                      │
│    │  ├─ 汇总所有 pending_learning_events                    │
│    │  ├─ 对每个事件:                                         │
│    │  │   ├─ 比较实际表现 vs 能力模型预期                    │
│    │  │   ├─ 计算 proficiency delta                         │
│    │  │   ├─ memory_lesson_save(LearningEvent)               │
│    │  │   └─ memory_slot_replace("competency_model", ...)    │
│    │  └─ 如果出现重复错误 → 提升为 anti_pattern              │
│    │                                                         │
│  OPENCLAW SESSION END ────────────────────────────────────▶ │
│    │                                                         │
│    └─ [Hook: session_end]                                    │
│        ├─ 生成本次会话成长总结                               │
│        ├─ memory_patterns() → 检测新行为模式                 │
│        ├─ 生成演化提案（如有显著能力变化）                   │
│        └─ memory_save(type="mental_state", 本轮反思)         │
└────────────────────────────────────────────────────────────┘
```

---

## 各 Hook 详解

### 1. session_start

| 动作 | 频率 | 延迟敏感 | 说明 |
|------|------|---------|------|
| 加载能力模型摘要 | 每次会话开始 | 是 | `memory_slot_get("competency_model")` |
| 加载自主性策略 | 每次会话开始 | 是 | `memory_slot_get("autonomy_policy")` |
| 加载工具注册表 | 每次会话开始 | 是 | `memory_slot_get("tool_registry")` |
| 恢复思维状态 | 每次会话开始 | 是 | `memory_smart_search("mental_state", 3)` |
| 注入系统提示 | 每次会话开始 | 是 | 格式化 Praxis Context 块到 system prompt |

**重要**：按照 OpenClaw 的性能准则，所有高频数据在 session_start 时一次性批量加载，会话期间不再重复调用 AgentMemory。在 plugin 内存中缓存，避免 "repeated request-time discovery"。

### 2. before_tool_call

每次 OpenClaw agent 准备调用工具时触发。

```
输入: tool_id, action, params
输出: { autonomy_decision, injected_context }

autonomy_decision:
  - "proceed"       → 自主执行
  - "inform"        → 执行但告知用户
  - "confirm"       → 需要用户确认
  - "block"         → 拒绝执行（风险过高或发生过严重错误）

injected_context (可选):
  - known_failure_modes: ["执行前检查 X"]
  - user_preferences: {key: value}
  - best_practices: ["建议使用 Y 参数"]
```

### 3. after_tool_call

每次工具执行完成后触发。

```
输入: tool_id, action, result (success/failure + details)
输出: pending_learning_event (存储在 plugin 内存中，不在此时写 AgentMemory)

处理逻辑:
  - 成功 → 检查质量指标是否超出预期？
  - 失败 → 匹配已知错误模式？
    - 已知模式 → 记录重复次数
    - 新模式 → 创建新的 failure_mode 条目
  - 用户纠正 → 高权重学习信号
```

### 4. agent_end

OpenClaw agent 完成一轮任务后触发。

```
动作:
  1. 汇总所有 pending_learning_events
  2. 对每个事件调用 LearningEngine.process()
  3. 更新受影响的 skill proficiency
  4. memory_lesson_save(LearningEvent)  // 批量写入
  5. memory_slot_replace("competency_model", updated)  // 更新能力模型
```

**性能考量**：`agent_end` 是唯一执行 AgentMemory 写操作的 hook（session_end 除外）。避免了在每个 `after_tool_call` 中频繁写 MCP。

### 5. session_end

OpenClaw 会话关闭时触发。

```
动作:
  1. 会话摘要 + 自我反思
  2. memory_patterns() → 检测新出现的稳定行为模式
  3. 生成演化提案（如有显著的能力变化）
  4. memory_save(type="mental_state", ...)
  5. 能力模型版本快照（如模型有更新）
```

---

## 错误恢复与边界情况

| 场景 | 处理 |
|------|------|
| AgentMemory MCP 连接断开 | Praxis 降级为内存模式（本会话内有效，会话结束后丢失） |
| session_start 加载失败 | 使用上次已知的能力模型（从 OpenClaw 本地缓存） |
| agent_end 写入失败 | 重试 3 次，仍失败则保留在本地 pending queue，下次 session 重试 |
| before_tool_call 超时 | 默认降级为 "inform"（不阻塞工具执行） |

---

## 后台定期任务（V2 更新）

| 周期 | 任务 | 触发方式 |
|------|------|---------|
| 每次 agent_end | 学习事件批量写入 | agent_end hook |
| 每次 session_end | 技能评估校准 | session_end hook |
| 每天 | 知识固化 | AgentMemory consolidation pipeline |
| 每周 | 能力缺口分析 | OpenClaw cron + Praxis analysis skill |
| 每月 | 能力模型审计 | OpenClaw cron + Praxis audit skill |

---

## 兄弟文件

- [What is Praxis V2?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？
- [Why Praxis V2?](why.md) — 为什么是这个组合
- [How does it work?](how.md) — Praxis Plugin 架构详解
- [Where does it sit?](where.md) — 架构定位与系统关系
- [Architecture Design](design.md) — V2 集成架构设计文档
