# Praxis Phase 1A — Error Recovery Strategy

## 错误分类体系

| 错误码 | 严重度 | 含义 |
|--------|--------|------|
| `AGENTMEMORY_UNAVAILABLE` | HIGH | AgentMemory 不可达 |
| `TIMEOUT` | HIGH | MCP/LLM 调用超时 |
| `NOT_FOUND` | MEDIUM | 请求的 slot 不存在 |
| `SESSION_NOT_STARTED` | MEDIUM | 事件在 session_start 之前到达 |
| `SESSION_ALREADY_STARTED` | LOW | 重复的 session_start |
| `SCHEMA_ERROR` | LOW | slot 返回格式不符合预期 |
| `UNKNOWN_EVENT` | LOW | 无法识别的事件类型 |

## 逐模块错误恢复表

### 1. PlatformAdapter

| 错误场景 | 错误码 | 恢复动作 | 用户可见 |
|---------|--------|---------|---------|
| 非 session_start 事件先到达 | `SESSION_NOT_STARTED` | 拒绝事件，返回错误。不崩溃。 | 工具调用被阻止，需先触发 session_start |
| 重复 session_start | `SESSION_ALREADY_STARTED` | 拒绝重复，返回错误。 | 无影响（幂等保护生效） |
| 重复 session_end | — | 返回空事件列表，不重复处理。 | 学习事件不重复（幂等保护生效） |
| AgentMemory 不可用（session_start） | — | 使用默认 competency model。tier="C"。 | 性能概况使用默认值，带"缓存数据"标记 |
| AgentMemory 不可用（before_tool_call） | — | 返回保守决策 `confirm`。 | 无法确认熟练度的工具调用需用户确认 |
| AgentMemory 不可用（message_received 写入） | — | 静默继续。学习事件丢失。 | 本轮学习未保存（降级：不阻塞对话） |

### 2. MemoryClient

| 错误场景 | 错误码 | 恢复动作 | 用户可见 |
|---------|--------|---------|---------|
| MCP getSlot 超时 | `TIMEOUT` | 返回错误，由调用方决定降级策略。 | 取决于调用方（session_start→默认模型，before_tool_call→保守决策） |
| MCP setSlot 超时 | `TIMEOUT` | 返回错误。如 enableCache=true，加入本地写队列。 | 学习事件延迟持久化 |
| slot 不存在 | `NOT_FOUND` | 返回错误。 | 调用方降级处理（如使用空模型） |
| MCP 返回格式错误（非 {ok,value} 格式） | `UNKNOWN` | v1 宽松处理：按原始值返回。 | 数据可能格式不符预期（Phase 2 加 schema 校验） |

### 3. SessionStartHandler

| 错误场景 | 错误码 | 恢复动作 | 用户可见 |
|---------|--------|---------|---------|
| getSlot 失败 | 传播 MemoryClient 错误码 | 使用 DEFAULT_MODEL + tier="C" + stale 标记。 | 上下文使用默认值，带"缓存数据"标记 |
| getSlot 返回 null value | — | 使用 DEFAULT_MODEL。 | 同上 |
| competency_model 格式错误 | — | 宽松解析，缺失字段按空数组处理。 | 上下文不包含对应区块 |
| 空 skills 数组 | — | 正常处理，输出"无技能数据"。 | 上下文中能力概况区域显示提示 |

### 4. SessionEndHandler

| 错误场景 | 错误码 | 恢复动作 | 用户可见 |
|---------|--------|---------|---------|
| 重复 sessionId | — | 返回空事件列表，不重复分析。 | 无影响（幂等保护生效） |
| analyzeTranscript 返回空 | — | 不调用 setSlot，无副作用。 | 本次 session 无学习事件记录 |
| setSlot 写入失败 | `AGENTMEMORY_UNAVAILABLE` 或 `TIMEOUT` | 返回错误。v1 无本地队列（这由 MemoryClient 的 enableCache 控制）。 | 学习事件可能丢失（Phase 2 加本地兜底） |

### 5. TranscriptAnalyzer

| 错误场景 | 错误码 | 恢复动作 | 用户可见 |
|---------|--------|---------|---------|
| 空 transcript | — | 返回 []。 | 无学习事件 |
| 极长 transcript (>8000 chars) | — | 截断到前 8000 字符。 | 超长对话的后半段未被分析（v1 限制） |
| regex 无匹配 | — | 返回 []。 | 无学习事件（正常情况） |

## 降级层级

```
Level 0: 正常运行          所有依赖可用
Level 1: AgentMemory 不可用  读→默认值，写→本地队列（enableCache=true）
Level 2: LLM 不可用          跳过 LLM 分析（v1 无此依赖，Phase 2 影响 transcript-analyzer）
Level 3: 完全降级            使用硬编码默认值，零外部依赖，仅输出警告
```

## Phase 2 改进

- 本地写队列在重连后自动回放（含 baseVersion 冲突检测）
- LLM 调用失败时 fallback 到 regex 分析（而非完全跳过）
- schema 严格校验（Phase 1 是宽松模式）
- 错误计数和告警阈值（>5 次 TIMEOUT/10min → 告警）
