# When does AgentOS V10 operate?

> V10 的增量极小，可以在 V9 基础上叠加。Phase 1（核心 TaskContext）仅需 2-3 周。Phase 2（ProtoTask）是可选的远期增强。

---

## 一、实现路线图总览

```
Phase 1 (核心交付)                          Phase 2 (可选增强)
│                                           │
│ TaskContext 注入 + 更新 + 任务感知优先级    │ ProtoTask 构造 + 任务模式学习
│                                           │
│ • task-context.ts                         │ • proto-task.ts
│ • session_start/end 微调                   │ • construct-proto-task prompt
│ • context-organizer 任务排序               │ • ProtoTask 验证
│ • /agentos task 命令                       │ • 任务历史分析 cron
│                                           │
│ 目标: 消除"任务认知真空"                   │ 目标: 学习任务模式
│                                           │
├──────────────── 2-3 周 ───────────────────┼──────── 3-4 周 ──────────┤
│                                           │
▼                                           ▼
总计 Phase 1: ~3 周 (可叠加在 V9 之上)
Phase 2: 可选, 需积累 >= 3 个同类项目的完成记录
```

---

## 二、Phase 1: TaskContext 核心交付（2-3 周）

### 目标
AgentOS 获得任务认知感知能力——知道当前在做什么项目、处于哪个阶段、哪些认知结构最相关。

### 交付物

| 模块 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **task-context.ts** | TaskContext 加载/格式化/更新 | P0 | 小 (~50 行) |
| **task_context slot** | AgentMemory slot 创建 + 读写 | P0 | 小 |
| **session_start 微调** | Layer 1 注入 TaskContext | P0 | 极小 (~10 行) |
| **context-organizer 微调** | Tier A 任务感知排序 | P0 | 极小 (~10 行) |
| **session_end 微调** | LLM 进度推断 + TaskContext 更新 | P0 | 小 (~20 行) |
| **transcript-analyzer 微调** | 分析 prompt 中增加进度推断字段 | P0 | 极小 (~5 行) |
| **用户命令** | /agentos task start/update/status/end | P1 | 中 (~60 行) |
| **task_history** | 已完成任务的存档 + 查询 | P1 | 小 |

### Phase 1 明确不做

- ❌ ProtoTask 构造（Phase 2）
- ❌ 跨任务模式学习
- ❌ 任务模板推荐
- ❌ 不改变 V9 的任何核心架构（压力感知、验证、遥测等）

### Phase 1 验证标准

```
✅ TaskContext 正确注入: session_start 后的系统提示包含任务上下文
✅ LLM 进度推断准确率 > 60%: 10 个测试会话 → 进度推断与人工判断偏差 < 1 阶段
✅ 任务感知排序有效: 有 TaskContext 时，相关场景的结构排在 Tier A 前 3 位
✅ /agentos task 命令功能正常: start/update/status/end
✅ 子 Agent 继承 TaskContext: 子 Agent session_start 包含父任务上下文
✅ V9 所有测试仍然通过: Phase 1 是叠加，不改变 V9 行为
```

---

## 三、Phase 2: ProtoTask 任务模式学习（3-4 周，可选）

### 前置条件

```
Phase 2 需要积累至少 3 个已完成且已归档的同类项目。
触发条件: task_history 中同 task_type 的已完成任务 >= 3。
如果数据不足 → Phase 2 自动推迟。
```

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **proto-task.ts** | ProtoTask 构造 + 验证 | P1 |
| **construct-proto-task prompt** | LLM 归纳任务模式的 prompt 模板 | P1 |
| **task_history cron** | 每周检查是否满足 ProtoTask 构造条件 | P1 |
| **ProtoTask 注入** | 当存在匹配的 ProtoTask 时，在 Layer 1 中注入任务模式指引 | P1 |

### Phase 2 验证标准

```
✅ ProtoTask 归纳准确率 > 50%: 3 个同类项目 → 阶段划分与人工判断一致
✅ ProtoTask 注入后 LLM 的任务规划质量提升: A/B 测试
✅ ProtoTask 置信度随项目数增加而上升: 3 项目 < 5 项目 < 10 项目
```

---

## 四、V9 → V10 路线图对比

| 维度 | V9 Phase 0 | V10 Phase 1 | 差异 |
|------|-----------|------------|------|
| 交付模块 | 压力感知 + 四级压缩 | **TaskContext + 任务感知优先级** | 新增 1 个模块 |
| 工作量 | 3-4 周 | **2-3 周** | 更小 |
| Hook 改动 | session_start 重写 | **session_start/end 微调** | 极小改动 |
| 新 slot | 无 | **1 个 (task_context)** | 1KB |
| 新 LLM 调用 | 无 (全本地逻辑) | **1 个 (进度推断, session_end)** | 轻量 (max 1K tokens 输出) |

### 叠加部署

```
V10 Phase 1 可以直接叠加在 V9 之上:
  V9 + TaskContext → 任务认知感知
  不需要先完成 V9 Phase 1-3 再开始 V10
  两个版本可以并行开发
```

---

## 五、兄弟文件

- [What is AgentOS V10?](what-is.md) — V10 的工程定义
- [Why AgentOS V10?](why.md) — 第一性原理：为什么需要任务级认知
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — TaskContext 注入、ProtoTask 构造
- [Where does it sit?](where.md) — 模块树（V9 基础 + 1 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
