# Where does Praxis V10 sit?

> V10 在 V9 基础上的最小扩展：1 个新模块、1 个新 slot、2 个微调的 Hook。

---

## 一、完整模块树

```
openclaw/src/plugins/praxis-plugin/
├── index.ts
├── config.ts                              # [增强] task_context + proto_task 配置
│
├── hooks/
│   ├── session-start.ts                  # [微调] 注入 TaskContext + 任务优先级排序
│   ├── message-received.ts               # 同 V9
│   ├── before-tool-call.ts               # 同 V9
│   ├── after-tool-call.ts                # 同 V9
│   ├── agent-end.ts                      # 同 V9
│   └── session-end.ts                    # [微调] LLM 推断任务进度 + 更新 TaskContext
│
├── orchestration/
│   ├── context-pressure-monitor.ts       # 同 V9
│   ├── scene-recognizer.ts               # 同 V9
│   ├── context-organizer.ts              # [微调] 任务感知的 Tier A 优先级
│   ├── task-context.ts                   # [新 V10] TaskContext 读写 + 格式化
│   ├── confidence-fuser.ts               # 同 V9
│   └── prediction-protocol.ts            # 同 V9
│
├── analysis/
│   ├── transcript-analyzer.ts            # [微调] 输出中增加进度推断字段
│   ├── proto-task.ts                     # [新 V10] ProtoTask 构造 (Phase 2+)
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
│   ├── schemas.ts                        # [增强] TaskContext + ProtoTask 类型
│   ├── slots.ts                          # [增强] task_context slot
│   └── queries.ts
│
├── prompts/
│   ├── system/
│   │   ├── memory-context.md             # [微调] Layer 1 增加任务上下文
│   │   ├── prediction-markers.md
│   │   └── critical-mode.md
│   ├── analysis/
│   │   ├── extract-and-update.md         # [微调] 增加进度推断指令
│   │   ├── construct-proto-task.md       # [新 V10] ProtoTask 构造 prompt
│   │   ├── consistency-scan.md
│   │   └── audit-architecture.md
│   └── user/
│       ├── perception-summary.md
│       └── crystallization-proposal.md
│
├── types/
│   ├── memory.ts                         # [增强] TaskContext + ProtoTask
│   ├── scene.ts
│   └── hooks.ts
│
└── tests/
    ├── task-context.test.ts               # [新]
    └── proto-task.test.ts                 # [新] (Phase 2+)
```

---

## 二、V9 → V10 模块变化清单

### 新增模块（1-2 个）

| 模块 | 路径 | 职责 | Phase |
|------|------|------|-------|
| task-context | `orchestration/task-context.ts` | TaskContext 读写 + 注入格式化 + 更新 | Phase 1 |
| proto-task | `analysis/proto-task.ts` | ProtoTask 构造 + 验证 | Phase 2+ (可选) |

### 微调模块（4 个）

| 模块 | 变化 | 改动量 |
|------|------|--------|
| `hooks/session-start.ts` | 加载 TaskContext → 注入 Layer 1 → 任务感知 Tier A 排序 | ~15 行 |
| `hooks/session-end.ts` | LLM 推断进度 → 更新 TaskContext slot | ~10 行 |
| `orchestration/context-organizer.ts` | Tier A 排序中增加任务阶段权重 | ~5 行 |
| `analysis/transcript-analyzer.ts` | prompt 中增加进度推断字段 | ~5 行 |

### 新增 AgentMemory Slot

```
# task_context slot
# 存储: 当前活跃任务的上下文
# 大小: < 1KB
# 格式: TaskContext JSON
memory_slot_get: "task_context"     # session_start 读取
memory_slot_set: "task_context"     # session_end 更新 / 用户命令

# task_history (memory type, 非 slot)
# 存储: 已完成任务的 TaskContext 快照
# 查询: memory_smart_search(type="task_history")
# 保存时机: 任务结束时 / 任务阶段变更时
```

---

## 三、数据流（V10 微调）

```
session_start (V10 微调):
  1. 全量加载结构到内存
  2. 场景识别
  3. 【新 V10】加载 TaskContext:
     └─ memory_slot_get("task_context") → TaskContext | null
  4. 上下文压力测量
  5. 自适应注入:
     Layer 1: 
       【新 V10】+ "## 当前任务: {task_name} ({current_phase})
                   进度: {progress_summary}"
     Layer 2 (任务感知优先级):
       Tier A = 当前场景结构 + 【新 V10】task_context.relevant_scenarios 的结构
       排序权重 = 场景匹配度 × 0.6 + 【新 V10】任务相关性 × 0.4

session_end (V10 微调):
  1-6. (同 V9)
  7. 【新 V10】如果 task_context.auto_update:
     LLM 分析 transcript → 推断进度变化 → 更新 TaskContext
     → memory_slot_set("task_context", updated)

子 Agent session_start (V10 微调):
  子 Agent 的 session_start hook 触发:
    → 从父 Agent 的 TaskContext slot 读取 →
    → 注入子 Agent 的系统提示
    → 子 Agent 获得任务认知上下文
    → 子 Agent 的 ProtoStructure 更新写入 AgentMemory
       (父 Agent 在下次 session_start 时读取到最新版本)
```

---

## 四、兄弟文件

- [What is Praxis V10?](what-is.md) — V10 的工程定义
- [Why Praxis V10?](why.md) — 第一性原理：为什么需要任务级认知
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — TaskContext 注入、ProtoTask 构造
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Architecture Design](design.md) — 技术规格与 API 契约
