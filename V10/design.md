# AgentOS V10 Architecture Design

> 版本：v10 (Task-Level Cognitive Awareness)
> 状态：设计阶段
> 基于：V9 + 任务级认知第一性原理分析 (2026-06-11)

---

## 零、架构哲学：认知索引，而非执行计划

```
V9:  AgentOS 理解场景（"医院门诊的流程是什么"）
V10: AgentOS 理解任务中的场景（"在构建医院系统 Phase 2 的上下文中，
      门诊流程和 API 设计模式是最相关的认知结构"）

关键边界:
  AgentOS 不替代 planning-with-files 做任务规划。
  AgentOS 不替代 OpenClaw 做子 Agent 调度。
  AgentOS 只做一件事: 提供任务级认知上下文——
  "当前在做什么、处于哪个阶段、哪些认知结构最相关"。
  
  这是认知索引，不是执行计划。
```

---

## 一、V10 新增数据模型

### 1.1 TaskContext

```typescript
// types/memory.ts

interface TaskContext {
  task_id: string;                 // "task_hospital_sys_2026"
  task_name: string;               // "构建医院管理系统"
  task_type: string | null;        // "software_project" | "research" | "writing" | null
  current_phase: string | null;    // "Phase 2: API Development"
  progress_summary: string;        // "数据模型完成, API 60% (预约挂号进行中)"
  active_subtask: string | null;   // "实现预约挂号接口"
  relevant_scenarios: string[];    // ["hospital_outpatient", "api_design"]
  started_at: number;
  last_updated_at: number;
  auto_updated: boolean;           // 本次更新是否来自 LLM 自动推断
}
```

### 1.2 ProtoTask（Phase 2+）

```typescript
interface ProtoTask {
  task_id: string;
  task_type: string;
  tentative_name: string;
  confidence: number;

  typical_phases: {
    name: string;
    typical_duration: string;
    key_scenarios: string[];
    relevant_structure_ids: string[];
    common_challenges: string[];
  }[];

  common_pitfalls: {
    description: string;
    affected_phases: string[];
    mitigation: string;
  }[];

  observations_count: number;
  source_tasks: string[];
  confidence_trend: { after_observation: number; confidence: number }[];
  created_at: number;
  last_updated_at: number;
}
```

### 1.3 TaskContextInjection

```typescript
// types/scene.ts

interface TaskContextInjection {
  formatted_text: string;          // 注入到 Layer 1 的任务上下文文本
  token_count: number;             // ~150-250
  priority_boost: {                // Tier A 排序权重调整
    scenario_id: string;
    boost_factor: number;          // 1.0 - 2.0
  }[];
}
```

---

## 二、AgentMemory 集成规格

### 2.1 新增 Slot

```yaml
# task_context slot
# 存储: 当前活跃任务的上下文
# 大小: < 1KB
# 格式: TaskContext JSON
memory_slot_get: "task_context"     # session_start 读取
memory_slot_set: "task_context"     # session_end 更新 / 用户命令
# 更新频率: session_end (自动) 或 用户命令 (手动)
```

### 2.2 新增 Memory Type

| Type | 数据结构 | 查询方式 | 保存时机 |
|------|---------|---------|---------|
| `task_history` | TaskContext (快照) | `memory_smart_search(task_type)` | 任务结束 / 阶段变更 |
| `proto_task` | ProtoTask | `memory_smart_search(task_type)` | ProtoTask 构造/更新 |

### 2.3 API 调用频率估算（V10 增量）

```
session_start (新增):
  └─ memory_slot_get("task_context")              [1 次]

session_end (新增):
  ├─ LLM 进度推断调用 (仅当 task_context 存在)     [0-1 次]
  │   token 消耗: ~2K (prompt) + 1K (output)
  └─ memory_slot_set("task_context")              [0-1 次] (仅当有更新)

总计增量: 1 次读 + 0-1 次 LLM 调用 + 0-1 次写
```

---

## 三、GovernancePolicy 新增配置

```typescript
interface GovernancePolicy {
  // ... (V7 + V8 + V9 所有字段保持不变)

  taskContext: {
    enabled: boolean;                            // 默认 true
    auto_update: boolean;                        // 默认 true
    auto_update_confidence_threshold: number;     // 默认 0.7
    max_task_history: number;                    // 默认 20
    inject_in_critical_mode: boolean;            // 默认 true (200 tokens 即使在 Critical 下也可接受)
  };

  protoTask: {
    enabled: boolean;                            // 默认 false (Phase 2+)
    min_observations: number;                    // 默认 3
    min_confidence_for_guidance: number;          // 默认 0.6
    construct_on_cron: string;                   // 默认 "0 6 1 * *" (每月)
  };
}
```

---

## 四、Layer 1 注入格式

```
V9 Layer 1:
  # AgentOS 认知状态
  ## 已知场景
  - hospital_outpatient: 门诊流程 (原型: 3, 固化: 1)
  ## 当前场景: hospital_outpatient
  ## 架构版本: 2.1.3

V10 Layer 1 (新增 TaskContext):
  # AgentOS 认知状态

  ## 当前任务
  任务: 构建医院管理系统
  阶段: Phase 2 — API 开发
  进度: 数据模型完成, API 60% (预约挂号进行中)
  活跃子任务: 实现预约挂号接口
  (进度由 AgentOS 自动推断，可能有误 — 用 /agentos task update 修正)

  ## 已知场景
  - hospital_outpatient: 门诊流程 (原型: 3, 固化: 1)
  - api_design: REST API 设计模式 (原型: 2, 固化: 1)  [任务相关]
  ## 当前场景: hospital_outpatient
  ## 架构版本: 2.1.3
```

---

## 五、V7 → V8 → V9 → V10 完整差异矩阵

| 维度 | V7 | V8 | V9 | V10 |
|------|----|----|----|-----|
| 上下文约束 | Token 稀缺 | Token 充裕 | **四级自适应** | 同 V9 |
| 注入策略 | 选择性 | 全量 | **压力自适应** | 同 V9 + **任务优先级** |
| Token 爆炸保护 | 无 | 无 | **四级降级 + Lazy** | 同 V9 |
| 注意力管理 | 无 | Tier A/B/C | **+利用率追踪** | 同 V9 + **任务感知排序** |
| 统计验证 | 无 | ProtoSequence | **+Role+Concept** | 同 V9 |
| 认知层级 | 场景级 | 场景级 | 场景级 | **场景级 + 任务级** |
| 任务感知 | 无 | 无 | 无 | **TaskContext (~200 tokens)** |
| 任务模式学习 | 无 | 无 | 无 | **ProtoTask (Phase 2+)** |
| 子 Agent 认知继承 | 无 | 无 | 无 | **TaskContext 注入** |
| 跨会话任务动量 | 无 | 无 | 无 | **进度推断 + 自动更新** |
| AgentMemory Slots | 6 | 6 | 6 | **7 (+task_context)** |
| 代码模块 | ~20 | ~19 | ~26 | **~27 (+1)** |
| 实现周期 | 4-5 月 | 3 月 | ~4 月 | **+2-3 周 (Phase 1)** |

---

## 六、与 OpenClaw / planning-with-files 的接口

```
架构边界:

  ┌─────────────────────────────────────────────────────────┐
  │                     OpenClaw                              │
  │                                                           │
  │  planning-with-files skill:                               │
  │    职责: 任务计划的文件持久化                               │
  │    存储: markdown 文件                                    │
  │    内容: 任务分解树、待办列表、决策记录                      │
  │                                                           │
  │  sub-agent orchestration:                                 │
  │    职责: 子 Agent 的 spawn / monitor / aggregate           │
  │    session_start hook → AgentOS 自动注入 TaskContext       │
  │                                                           │
  │  context compaction:                                      │
  │    职责: 长会话的自动摘要                                  │
  │    与 AgentOS 的关系: 摘要后的对话仍然进入 transcript       │
  │                      → AgentOS 仍然可以从中学习             │
  └─────────────────────────────────────────────────────────┘
                              │
          TaskContext (轻量接口, ~200 tokens)
                              │
  ┌─────────────────────────────────────────────────────────┐
  │                     AgentOS V10                           │
  │                                                           │
  │  task-context.ts:                                        │
  │    职责: TaskContext 的读写、注入、自动更新                 │
  │    输入: AgentMemory slot "task_context"                  │
  │    输出: Layer 1 注入文本 + Tier A 优先级调整              │
  │                                                           │
  │  proto-task.ts (Phase 2+):                               │
  │    职责: 从已完成任务中学习任务模式                         │
  │    输入: task_history memory type                        │
  │    输出: ProtoTask 认知结构                               │
  └─────────────────────────────────────────────────────────┘
```

---

## 七、兄弟文件

- [What is AgentOS V10?](what-is.md) — V10 的工程定义
- [Why AgentOS V10?](why.md) — 第一性原理：为什么需要任务级认知
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — TaskContext 注入、ProtoTask 构造
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V9 基础 + 1 新增）
