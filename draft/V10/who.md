# Who is Praxis V10 for?

> V10 三角色模型不变。变化在于用户新增任务上下文相关命令，运维者管理 TaskContext 的更新策略，开发者实现轻量任务感知模块。

---

## 一、角色三角（不变）

```
              ┌──────────┐
              │  用户     │
              │ (User)    │
              └─────┬─────┘
                    │ 使用 Praxis 时:
                    │  • Praxis 知道"当前在做什么项目"
                    │  • 子 Agent 自动获得任务认知上下文
                    │  • 跨会话恢复时不需要重复解释任务背景
                    │  • 可手动设置/更新任务上下文
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  开发者   │  │  运维者   │  │  Praxis │
│(Developer)│  │(Operator) │  │  自身     │
└──────────┘  └──────────┘  └──────────┘
 实现 TaskContext  配置 TaskContext   感知任务上下文
 实现进度推断     更新策略           优化结构优先级
 实现 ProtoTask                     子 Agent 认知注入
```

---

## 二、用户（User）

### 新增交互

```
1. Praxis 自动感知任务上下文:
   session_start 时，如果 TaskContext 存在:
   LLM 在系统提示中看到:
   
   "## 当前任务
    任务: 构建医院管理系统
    阶段: Phase 2 — API 开发
    进度: 数据模型完成, API 60% (预约挂号进行中)
    活跃子任务: 实现预约挂号接口
   
   → LLM 不需要用户重复"我们在做什么"，直接进入工作状态。

2. 用户手动管理任务:
   /praxis task start "构建医院管理系统"
     → 创建新 TaskContext
   
   /praxis task update --phase "Phase 3: UI Development"
     → 更新任务阶段
   
   /praxis task progress "API 全部完成, 开始前端"
     → 更新进度摘要
   
   /praxis task status
     → 查看当前 TaskContext
   
   /praxis task end
     → 结束当前任务，TaskContext 移至任务历史

3. 子 Agent 透明继承:
   用户: "帮我写数据库迁移脚本" → OpenClaw 启动子 Agent
   子 Agent 自动获得 TaskContext + 相关 ProtoStructure
   用户不需要手动告诉子 Agent "我们在做医院系统"
```

---

## 三、开发者（Developer）

### V9 → V10 新增职责

| 新增模块 | 职责 | 复杂度 |
|---------|------|--------|
| `task-context.ts` | TaskContext 读写 + 注入格式化 | 低 (~50 行) |
| session_start 微调 | 注入 TaskContext + 任务感知优先级 | 低 (~20 行改动) |
| session_end 微调 | LLM 推断进度 + 更新 TaskContext | 低 (~15 行改动) |
| `proto-task.ts` (Phase 2+) | ProtoTask 构造 + 验证 | 中 (复用 ProtoStructure 模式) |

### 关键设计决策

```
决策 1: TaskContext 由谁更新？
  方案 A: 仅用户手动更新 → 简单但依赖用户
  方案 B: 仅 LLM 自动推断 → 可能不准确
  方案 C: LLM 推断 + 用户可覆盖 → 推荐
    session_end: LLM 分析 transcript → 推断进度变化 → 更新 TaskContext
    用户可随时用 /praxis task update 覆盖自动推断

决策 2: TaskContext 存储位置？
  方案: AgentMemory slot "task_context"
  大小: < 1KB
  读取: session_start
  写入: session_end (LLM 推断) 或用户命令

决策 3: ProtoTask 与 ProtoStructure 的关系？
  ProtoTask 是 ProtoStructure 的容器/索引。
  ProtoTask.phase_structures 引用已有的 ProtoStructure。
  不创建新的结构类型——只是将已有的结构按任务阶段组织。
```

---

## 四、运维者（Operator）

### GovernancePolicy 新增配置

```yaml
task_context:
  enabled: true
  auto_update: true                 # session_end LLM 自动推断进度
  auto_update_confidence_threshold: 0.7  # LLM 推断置信度 < 此值 → 不自动更新
  max_task_history: 20              # 保留最近 N 个已完成任务的上下文

proto_task:
  enabled: false                    # Phase 2+ 启用
  min_observations: 3               # 至少完成 3 次同类项目才构造 ProtoTask
  min_confidence_for_guidance: 0.6  # ProtoTask 置信度 > 此值才在任务中使用
```

---

## 五、Praxis 自身的"自主权边界"（与 V9 相同）

V10 不改变 Praxis 的自主权边界。TaskContext 是一个索引——它不驱动行动，只提供上下文。

---

## 兄弟文件

- [What is Praxis V10?](what-is.md) — V10 的工程定义
- [Why Praxis V10?](why.md) — 第一性原理：为什么需要任务级认知
- [How does it work?](how.md) — TaskContext 注入、ProtoTask 构造
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V9 基础 + 1 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
