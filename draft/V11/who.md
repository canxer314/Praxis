# Who is Praxis V11 for?

> V11 三角色模型不变。变化在于四个结构化接口的引入改变了各角色的交互方式和职责范围。

---

## 一、角色三角（不变）

```
              ┌──────────┐
              │  用户     │
              │ (User)    │
              └─────┬─────┘
                    │ 使用 Praxis + OpenClaw 时:
                    │  • Praxis 的 ProtoTask 自动进入任务计划
                    │  • 任务中的反馈自动改进 Praxis 的认知
                    │  • 错误的结构在会话中被即时修正
                    │  • 可以用 /praxis task feedback 手动反馈
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  开发者   │  │  运维者   │  │  Praxis │
│(Developer)│  │(Operator) │  │  自身     │
└──────────┘  └──────────┘  └──────────┘
 实现四个接口    配置接口行为     生成 GuidanceSignal
 实现 ProtoTask  管理置信度参数   处理 OutcomeFeedback
 实现实时学习    监控闭环质量     会话中实时学习
```

---

## 二、用户（User）

### V10 → V11 新增交互

```
1. 任务计划自动包含 Praxis 的知识:
   用户: "开始一个新的医院系统项目"
   OpenClaw → planning-with-files 创建计划文件
   → planning-with-files 查询 Praxis 知识库
   → 获得: ProtoTask "医院系统开发" 的阶段模板 + 常见陷阱
   → 计划文件中自动包含:
     "## 推荐阶段 (来源: Praxis, 置信度 0.65)
      - Phase 1: 需求分析 (2-3周)
      - Phase 2: 数据模型设计 (1-2周)
      - Phase 3: API 开发 (3-4周) [⚠ 陷阱: 医保对接模块容易被低估]
      - ..."
   → 用户看到的是一个有历史经验支撑的计划，不只是 LLM 的通用模板

2. 认知指导信号在会话中可见:
   session_start 后，LLM 的系统提示中出现:
   
   "## ⚠ 认知指导 [Praxis V11]
    [WARNING] 当前 Phase 常见陷阱: 医保对接模块容易被低估 (置信度 0.65)
    [INFO] 推荐关注结构: api_design, rest_patterns, outpatient_flow
    [INFO] 建议: 完成预约挂号 API 后优先锁定医保接口的外部依赖"
   
   → 用户看到 Praxis 在主动提醒 LLM

3. 会话中错误被即时修正:
   用户: "不对，我们医院的流程改了，现在挂号之后直接分诊"
   → Praxis (mid-session): 检测到对 "门诊流程" ProtoSequence 的纠正
   → 即时下调该序列的置信度 (-0.08)
   → 本次会话中后续不再强调这个被纠正的序列

4. 用户手动反馈任务结果:
   /praxis task feedback --subtask "预约挂号 API" --outcome "partial_success"
     --note "功能正确但响应时间不达标"
   → ProtoStructure 置信度根据结果调整
   → ProtoTask 的阶段时长估计更新

5. 查看知识闭环状态:
   /praxis knowledge status
   → "ProtoTask '医院系统开发': 置信度 0.45 (3 次观察)
      最近反馈: Phase 2 实际比预估多 1.5 周 (2 次)
      陷阱预警准确率: 60% (3/5 次正确预警)
      GuidanceSignal 采纳率: 45% (9/20 次被 LLM 遵循)"
```

---

## 三、开发者（Developer）

### V10 → V11 新增职责

| 新增模块 | 职责 | 复杂度 | 说明 |
|---------|------|--------|------|
| `knowledge-query.ts` | 知识查询端点 | 中 (~80 行) | 查询路由 + 结果聚合 + ProtoTask 匹配 |
| `cognitive-guidance.ts` | GuidanceSignal 生成 | 中 (~100 行) | 信号生成逻辑 + severity 判定 + 格式化 |
| `outcome-feedback.ts` | 结果反馈处理 | 中 (~80 行) | 置信度调整算法 + ProtoTask 更新 |
| `mid-session-learner.ts` | 实时矛盾检测 | 低 (~60 行) | 纯规则匹配 + 频次计数 + 即时调整 |
| `proto-task.ts` | ProtoTask 构造 | 中 (~120 行) | Bootstrap + 累积构造 + 置信度成长 |

| 修改模块 | 改动 | 说明 |
|---------|------|------|
| `hooks/session-start.ts` | +GuidanceSignal 注入 | ~20 行 |
| `hooks/message-received.ts` | +detectUserCorrection | ~10 行 |
| `hooks/before-tool-call.ts` | +detectToolPatternViolation | ~10 行 |
| `hooks/session-end.ts` | +outcome 加权更新 | ~15 行 |
| `orchestration/task-context.ts` | +outcome 处理 | ~10 行 |
| `orchestration/confidence-fuser.ts` | +outcome 信号源 | ~10 行 |
| `analysis/transcript-analyzer.ts` | +outcome-weighted 分析 | ~10 行 |

### 关键设计决策

```
决策 1: 知识查询 API 是同步函数调用还是异步 RPC？
  方案: 同进程同步函数调用。
  原因: Praxis 和 planning-with-files 在同一个 OpenClaw plugin 进程中。
       不需要 HTTP/RPC 开销。
  备选: 如果未来 planning-with-files 是独立进程，通过 AgentMemory slot 中转。

决策 2: GuidanceSignal 注入到 prompt 的哪个位置？
  方案: Layer 1（认知状态）中，TaskContext 之后、场景列表之前。
  原因: 指导信号的优先级高于场景列表——LLM 应该先看到"注意什么"，
        再看"有哪些已知场景"。
  格式: 见 design.md 的 Layer 1 注入格式。

决策 3: MidSessionLearner 的检测是同步还是异步？
  方案: 同步（在 hook 回调中直接执行）。
  原因: 纯规则匹配 < 10ms，不会阻塞消息处理。
       不能异步——需要在 LLM 收到下一条消息之前完成置信度调整。

决策 4: Bootstrap ProtoTask 何时触发？
  方案: 用户创建新 TaskContext 时如果 task_type 有值 → 立即触发。
  时机: /praxis task start --type "software_project" 时，
        或在 session_start 检测到新 task_type 时。
  开销: 一次 LLM 调用 (~2K tokens prompt + 1K output)，可接受。
```

---

## 四、运维者（Operator）

### GovernancePolicy 新增配置

```yaml
# V11 新增配置

cognitive_guidance:
  enabled: true
  max_signals_per_injection: 5          # 每次注入最多 5 个信号 (~100 tokens)
  min_confidence_for_warning: 0.5       # pitfall_warning 最少置信度
  min_confidence_for_suggestion: 0.3    # phase_suggestion 最少置信度
  inject_in_critical_mode: true         # Critical 压力下仍注入（信号极短）

outcome_feedback:
  enabled: true
  success_boost: 0.05                   # 成功 → 使用的结构 +0.05
  failure_penalty: 0.05                 # 失败 → 使用的结构 -0.05
  partial_success_boost: 0.02           # 部分成功 → +0.02
  abandoned_penalty: 0.03               # 放弃 → -0.03
  pitfall_match_boost: 0.1              # 陷阱预测命中 → ProtoTask.pitfall +0.1
  duration_accuracy_boost: 0.03         # 时长估计偏差 < 20% → ProtoTask +0.03
  min_outcomes_for_adjustment: 1        # 至少 1 个结果才开始调整

mid_session_learning:
  enabled: true
  contradiction_threshold: 3            # 同序列违反 3 次触发 moderate penalty
  critical_severity_penalty: 0.1        # critical 矛盾即时下调
  moderate_severity_penalty: 0.08       # moderate + 超过阈值 即时下调
  max_immediate_penalty_per_session: 0.2 # 单会话中即时下调上限（防过度修正）

knowledge_query:
  enabled: true
  allow_bootstrap: true                 # 允许零样本 ProtoTask
  bootstrap_confidence: 0.2             # Bootstrap ProtoTask 的初始置信度
  max_query_results: 10                 # 单次查询最多返回结果数
  cache_ttl_seconds: 3600               # 查询结果缓存 1 小时

proto_task:
  enabled: true                         # V11 默认启用（V10 默认关闭）
  bootstrap_on_task_start: true         # 新任务开始时自动 bootstrap
  min_observations_for_update: 1        # 1 次观察后即开始更新（V10 需要 3 次）
  construct_on_cron: "0 6 * * 0"        # 每周日早 6 点全量重建
```

---

## 五、Praxis 自身的"自主权边界"（关键不变）

V11 仍然不做：
- ❌ 触发任务分解——那是 planning-with-files 的事
- ❌ 启动/管理子 Agent——那是 OpenClaw 的事
- ❌ 执行工具——那是 LLM 的事
- ❌ 决策——那是用户的领域

V11 新增的"自主权"仅在于：
- ✅ 生成 GuidanceSignal（基于已有的 ProtoTask/ProtoStructure 数据——确定性逻辑）
- ✅ 处理 OutcomeFeedback（置信度算法——确定性数学）
- ✅ 检测实时矛盾（规则匹配——确定性逻辑）
- ✅ 响应知识查询（数据检索——确定性逻辑）

**这些都是"提供信息"而非"做出决策"。Praxis 的信息质量提高 → LLM 和 OpenClaw 的决策质量提高——但决策者不变。**

---

## 兄弟文件

- [What is Praxis V11?](what-is.md) — V11 的工程定义
- [Why Praxis V11?](why.md) — 第一性原理：为什么需要知行合一闭环
- [How does it work?](how.md) — 四个接口的完整实现
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V10 基础 + 5 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
