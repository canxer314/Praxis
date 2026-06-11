# When does Praxis V11 operate?

> V11 的增量比 V10 大（5 个新模块 vs 1 个），但比 V9 小（5 个 vs 7 个）。Phase 1（闭环核心）6 周，Phase 2（优化验证）4 周，总计 ~10 周。

---

## 一、实现路线图总览

```
Phase 1: 闭环核心 (6 周)
│
│  周 1-2: 行→知闭环
│  │ • mid-session-learner.ts         (接口 4: 实时学习)
│  │ • outcome-feedback.ts             (接口 3: 结果反馈)
│  │ • hooks 微调 (message_received, before_tool_call, session_end)
│  │
│  │ 目标: Praxis 能即时检测错误 + 能根据任务结果调整置信度
│  │
│  ├── 周 3-4: 知→行闭环 (第一步)
│  │ • knowledge-query.ts              (接口 1: 知识查询)
│  │ • proto-task.ts                   (Phase 1 核心 + bootstrap)
│  │ • memory 增强 (schemas, slots, queries)
│  │
│  │ 目标: planning-with-files 可以查询 Praxis 获取 ProtoTask
│  │
│  └── 周 5-6: 知→行闭环 (第二步)
│     • cognitive-guidance.ts          (接口 2: 认知指导信号)
│     • session-start 增强
│     • prompts 增强
│     
│     目标: Praxis 生成类型化 GuidanceSignal，OpenClaw 可解析
│
Phase 2: 优化与验证 (4 周)
│
│  周 7-8: 置信度算法升级
│  │ • confidence-fuser 重新校准 (纳入 outcome + mid-session 信号)
│  │ • 多源融合权重调整
│  │ • transcript-analyzer outcome-weighted 分析
│  │
│  └── 周 9-10: ProtoTask 质量验证
│     • Bootstrap 准确率 A/B 测试
│     • 观察增长曲线验证
│     • 端到端闭环测试
│     
│     目标: 四个接口全部在生产环境中验证
│
▼
总计: ~10 周
```

---

## 二、Phase 1: 闭环核心（6 周）

### 周 1-2: 行→知闭环

**目标**: Praxis 能即时检测认知矛盾 + 能根据任务结果调整置信度。

| 模块 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **mid-session-learner.ts** | 实时矛盾检测 + 即时置信度下调 | P0 | 小 (~60 行) |
| **message-received 微调** | detectUserCorrection 调用 | P0 | 极小 (~10 行) |
| **before-tool-call 微调** | detectToolPatternViolation 调用 | P0 | 极小 (~10 行) |
| **outcome-feedback.ts** | 结果反馈处理 + 置信度调整算法 | P0 | 中 (~80 行) |
| **session-end 微调** | outcome 加权置信度更新 | P0 | 小 (~15 行) |
| **task-context 微调** | outcome 处理集成 | P0 | 极小 (~10 行) |
| **types/memory.ts 增强** | +MidSessionContradiction + SubtaskOutcome | P0 | 小 |

**验证标准**:
```
✅ 用户说"不对，应该是..." → 对应结构置信度即时下调 ≥ 0.05
✅ 同序列 3+ 次工具违反 → 即时下调 0.08
✅ 单会话即时下调总量 ≤ max_immediate_penalty_per_session (0.2)
✅ 子任务 success → 使用的结构 +0.05
✅ 子任务 failure → 使用的结构 -0.05
✅ ProtoTask 陷阱预测命中 → pitfall 置信度 +0.1
```

### 周 3-4: 知→行闭环（第一步）

**目标**: planning-with-files 可以查询 Praxis 获取任务模式知识，ProtoTask 零样本可用。

| 模块 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **knowledge-query.ts** | 知识查询端点 + 路由 | P0 | 中 (~80 行) |
| **proto-task.ts** | Bootstrap + 累积构造 + 置信度成长 | P0 | 中 (~120 行) |
| **construct-proto-task.md** | Bootstrap prompt 模板 | P0 | 小 |
| **schemas.ts 增强** | +ProtoTask slot schema | P0 | 小 |
| **slots.ts 增强** | +proto_task slot | P0 | 小 |
| **queries.ts 增强** | +outcome 查询 | P0 | 小 |

**验证标准**:
```
✅ Bootstrap: task_type="software_project" → 生成 ProtoTask (置信度 0.2)
✅ 查询: queryKnowledge({query_type: "proto_task", task_type: "software_project"})
        → 返回 ProtoTask 模板
✅ ProtoTask 置信度成长: 1 次观察 → 0.3, 3 次观察 → 0.5
✅ ProtoTask 从 task_history 自动更新
```

### 周 5-6: 知→行闭环（第二步）

**目标**: Praxis 生成类型化 GuidanceSignal，注入到 prompt + 可供 OpenClaw 解析。

| 模块 | 内容 | 优先级 | 工作量 |
|------|------|--------|--------|
| **cognitive-guidance.ts** | GuidanceSignal 生成逻辑 | P0 | 中 (~100 行) |
| **session-start 增强** | +GuidanceSignal 注入到 Layer 1 | P0 | 中 (~20 行) |
| **memory-context.md 增强** | +认知指导信号注入格式 | P0 | 小 |
| **prompts 增强** | guidance 相关 prompt 模板 | P1 | 小 |

**验证标准**:
```
✅ TaskContext 存在 + ProtoTask 匹配 → 生成 phase_suggestion
✅ ProtoTask.common_pitfalls 非空 → 生成 pitfall_warning (severity=warning)
✅ 当前 Phase 的 relevant_structure_ids → 生成 structure_recommendation
✅ session_start 注入包含 "## ⚠ 认知指导 [V11]" 段
✅ GuidanceSignal 以结构化元数据形式附加在 hook 上下文中（OpenClaw 可解析）
```

---

## 三、Phase 2: 优化与验证（4 周）

### 周 7-8: 置信度算法升级

| 任务 | 说明 |
|------|------|
| confidence-fuser 重新校准 | 纳入 outcome 信号源 (权重 0.10)，mid-session 即时调整 |
| 多源融合权重调整 | statistical 0.25, role_verifier 0.12, concept_verifier 0.08, llm_marker 0.25, user_correction 0.12, outcome 0.10, mid_session 0.08 |
| transcript-analyzer 增强 | 分析 prompt 中增加 outcome 权重信息 |
| A/B 测试框架 | 对比有无 outcome-weighted 更新的 ProtoStructure 准确率 |

### 周 9-10: ProtoTask 质量验证

| 任务 | 说明 |
|------|------|
| Bootstrap 准确率测试 | 10 种 task_type → bootstrap 阶段划分 vs 人工标注 |
| 观察增长曲线 | 1/3/5/10 次观察后的 ProtoTask 质量 |
| GuidanceSignal 采纳率 | 统计 suggested_action 被遵循的比例 |
| 端到端闭环测试 | 完整流程: bootstrap → 任务执行 → 结果反馈 → 置信度更新 → 改进指导 |

---

## 四、V10 → V11 路线图对比

| 维度 | V10 Phase 1 | V11 Phase 1 | 差异 |
|------|------------|------------|------|
| 交付模块 | TaskContext + 任务感知排序 | **4 个接口 + ProtoTask 核心** | +4 个新模块 |
| 工作量 | 2-3 周 | **6 周** | 更大但合理 |
| Hook 改动 | session_start/end 微调 | **4 个 hook 增强** | message_received + before_tool_call 新增 |
| 新 slot | 1 个 (task_context) | **1 个 (proto_task)** | 相同 |
| 新 LLM 调用 | 1 个 (进度推断) | **2 个 (+ProtoTask bootstrap)** | 轻量增量 |
| ProtoTask | Phase 2+ (可选, ≥3 项目) | **Phase 1 核心 (bootstrap, 0 项目)** | 升格 |

### 叠加部署

```
V11 Phase 1 可以直接叠加在 V10 之上:
  V10 + 四个接口 → 知行合一闭环
  不需要先完成 V10 Phase 2 (ProtoTask 本来就是 V10 Phase 2)
  V11 把 ProtoTask 拉入 Phase 1 并增加 bootstrap

与 V9 的关系:
  V11 不改变 V9 的核心架构（压力感知、验证、遥测等）
  V11 是 V9→V10 这条线上的第三个增量版本
```

---

## 五、兄弟文件

- [What is Praxis V11?](what-is.md) — V11 的工程定义
- [Why Praxis V11?](why.md) — 第一性原理：为什么需要知行合一闭环
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 四个接口的完整实现
- [Where does it sit?](where.md) — 模块树（V10 基础 + 5 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
