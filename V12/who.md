# Who is AgentOS V12 for?

> V12 三角色模型不变。核心变化：AgentOS 从"知识提供者"升级为"任务编排者"——用户的交互方式、开发者的模块职责、运维者的配置范围都随之改变。

---

## 一、角色三角（不变的结构，变化的职责）

```
              ┌──────────┐
              │  用户     │
              │ (User)    │
              └─────┬─────┘
                    │ 使用 AgentOS + OpenClaw 时:
                    │  • 任务开始时 AgentOS 自动生成计划（基于 ProtoTask）
                    │  • 会话中看到结构化的进度和陷阱预警
                    │  • 子任务完成时 AgentOS 自动验收
                    │  • 陷阱命中时实时反馈到 ProtoTask 学习
                    │  • 可以用 /agentos task * 命令管理任务
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  开发者   │  │  运维者   │  │  AgentOS │
│(Developer)│  │(Operator) │  │  自身     │
└──────────┘  └──────────┘  └──────────┘
 实现编排状态机   配置编排行为    驱动任务状态机
 实现计划生成器   管理验证参数    生成计划 + 验收标准
 实现验收器       监控闭环质量    监控陷阱 + 反馈学习
 实现陷阱追踪器   设定 V13 触发   会话中实时修正
```

---

## 二、用户（User）

### V11 → V12 新增/变化的交互

```
1. 任务开始时 AgentOS 自动生成计划:
   用户: "开始一个新的医院系统项目"
   
   V11: planning-with-files 创建空模板 → 查询 AgentOS 获取 ProtoTask
        → LLM 填内容（AgentOS 的知识可能被忽略）
   
   V12: AgentOS 直接从 ProtoTask 生成 PlanDocument:
        → 写入 task_plan.md（阶段划分、子任务、验收标准、陷阱预警）
        → 注入到 LLM 上下文（结构化计划，非 prompt 建议）
        → 用户看到的计划标注了来源:
          "## 计划来源: ProtoTask '医院系统开发' (置信度 0.65, 5 次观察)"
        
   用户感知: 计划质量提高了——不是 LLM 每次从零猜测，而是基于历史经验。

2. 会话中看到结构化进度:
   session_start 后，LLM 系统提示中出现:
   
   "## 任务编排状态 [AgentOS V12]
   任务: 医院管理系统
   阶段: Phase 2/5 — API 开发
   当前子任务: 实现预约挂号 API (第 3/7 步)
   
   ⚠ 活跃陷阱预警:
   - 医保对接模块容易被低估 (历史命中 3/5 次, 严重度: 高)
   
   ✅ 已完成: 2 个子任务 (数据模型设计, 项目脚手架)
   📋 待完成: 5 个子任务
   
   验收标准 (当前子任务):
   - POST /appointments 返回 201
   - GET /appointments/:id 返回正确数据
   - 单元测试覆盖率 ≥ 80%"

3. 子任务完成时自动验收:
   用户: "预约挂号 API 写好了"
   
   V11: 用户需要手动判断是否完成
   
   V12: verifier 自动运行:
        → command_output: npm test -- --testPathPattern=appointments
        → file_existence: src/api/appointments/index.ts
        → 验收通过 → 子任务标记 VERIFIED → 自动激活下一个子任务
        → 验收不通过 → 子任务标记 FAILED → 生成修复建议

4. 陷阱命中时实时反馈:
   用户: "医保接口的文档和实际行为不一致，我们卡住了"
   
   V11: AgentOS 在 session_end 分析 transcript 时可能提取到
   
   V12: pitfall-tracker 实时匹配:
        → "医保对接模块容易被低估" 陷阱命中!
        → ProtoTask.pitfall.hit_count++
        → 下次同类任务开始时，陷阱预警的置信度更高
        → 计划中自动增加"锁定医保接口外部依赖"的预检查步骤

5. 用户管理任务:
   /agentos task status
   → "任务 '医院管理系统': Phase 2/5 (API 开发)
      子任务 3/7 进行中, 2 已验证, 0 失败
      陷阱命中: 1 (医保对接)
      估计剩余: 4-6 个 session"

   /agentos task plan
   → 输出完整的 PlanDocument（phases + subtasks + criteria + pitfalls）

   /agentos task verify --subtask "预约挂号 API"
   → 手动触发验收检查

   /agentos task abandon --reason "需求变更"
   → 标记任务 TASK_ABANDONED，保存最终状态供未来参考
```

---

## 三、开发者（Developer）

### V11 → V12 新增职责

| 新增模块 | 职责 | 复杂度 | 关键设计决策 |
|---------|------|--------|------------|
| `task-orchestrator.ts` | 两个嵌套 while() 循环状态机 | 高 (~200 行) | 状态机 transition 与 trigger 完全解耦（V13-ready） |
| `plan-generator.ts` | ProtoTask → PlanDocument + 嵌入 cognitive-guidance | 中 (~150 行) | Bootstrap vs 累积模式选择；token 预算控制 |
| `verifier.ts` | 5 种验收标准类型 + 自动运行 | 中 (~120 行) | 安全边界：command_output 在沙箱中运行 |
| `progress-tracker.ts` | Hook 驱动的进度事件记录 | 低 (~80 行) | 纯事件日志，不包含决策逻辑 |
| `plan-file-writer.ts` | 兼容 planning-with-files 格式的文件生成 | 低 (~100 行) | 必须与现有 hook 脚本兼容 |
| `pitfall-tracker.ts` | 失败匹配 + ProtoTask 反馈 | 中 (~100 行) | 误报率控制（阈值 + 人工确认） |

| V11→V12 修改模块 | 改动 | 说明 |
|------------------|------|------|
| `hooks/session-start.ts` | ~30 行 | 加载 TaskOrchestrationState + 调用 plan-generator + 注入计划上下文 |
| `hooks/session-end.ts` | ~40 行 | 运行 verifier + pitfall-tracker + processSubtaskOutcome + 持久化状态 |
| `hooks/message-received.ts` | ~25 行 | 路由到 orchestrator 内层循环 + 完成信号检测 |
| `hooks/before-tool-call.ts` | ~15 行 | 工具范围守卫 |
| `analysis/mid-session-learner.ts` | ~50 行 | 订阅 orchestrator 事件 + detectSubtaskCompletionSignal |
| `analysis/proto-task.ts` | ~30 行 | pitfall-tracker 反馈集成（hit_count, last_hit_task_id） |
| `orchestration/confidence-fuser.ts` | ~15 行 | +task_outcome 信号源（macro-level 成败信号） |

### V11 → V12 移除模块

| 模块 | 去向 |
|------|------|
| `api/knowledge-query.ts` | → `getProtoTaskTemplate()` 内部函数（plan-generator 调用） |
| `orchestration/cognitive-guidance.ts` | → 嵌入 PlanDocument.phases[].guidance（计划本身包含指导） |
| `analysis/outcome-feedback.ts` | → `processSubtaskOutcome()` 内部函数（task-orchestrator 调用） |

### 关键设计决策

```
决策 1: 状态机是单例还是每个 task 一个实例？
  方案: 每个 task 一个 TaskOrchestrationState 实例。
        AgentMemory slot "task_orchestration_state" 按 task_id 索引。
        不同 task 的状态完全隔离。
        同一 task 的多个 session 共享同一个状态实例。

决策 2: PlanDocument 何时重新生成？
  方案: 初始生成在首次 session_start 检测到任务时。
        重新生成在以下情况:
        - ProtoTask 置信度显著变化 (Δ > 0.2)
        - 用户显式请求 (/agentos task replan)
        - task 完成后，为下次同类任务更新 ProtoTask
        不会在每次 session_start 重新生成（保持计划稳定）。

决策 3: verifier 的 command_output 安全检查？
  方案: 仅运行白名单命令（npm test, cargo test, go test, pytest）。
        不允许任意 shell 命令。
        命令在 OpenClaw 的 exec tool 沙箱中运行。
        输出大小限制 100KB。

决策 4: pitfall-tracker 的误报如何处理？
  方案: 陷阱匹配需要至少匹配 ProtoTask.pitfall.description 中 2 个关键词。
        单次匹配不自动标记——需要同一子任务中 2+ 次匹配。
        用户可以手动清除误报: /agentos task pitfall-clear。
        误报率超过 30% 的陷阱自动降低 severity。

决策 5: V13 的主动触发如何预留？
  方案: task-orchestrator 的 advanceOuterLoop() 函数接受 trigger_source 参数
        ("hook:session_start" | "hook:session_end" | "cron:scheduled" | 
         "subagent:completed" | "heartbeat:wake")。
        V12 只使用前两个。后三个在 V13 激活。
        状态机 transition 逻辑不依赖 trigger_source——只影响日志和遥测。
```

---

## 四、运维者（Operator）

### GovernancePolicy 新增/变化配置

```yaml
# ── V12 新增: taskOrchestration ──
task_orchestration:
  enabled: true
  auto_generate_plan: true              # session_start 时自动生成计划
  auto_verify_on_session_end: true      # session_end 时自动验收
  max_concurrent_subtasks: 3            # 最多并行子任务数
  max_phases_per_plan: 10               # 单任务最多阶段数
  inject_plan_in_prompt: true           # 注入计划到 LLM 上下文
  inject_progress_in_prompt: true       # 注入进度摘要到 LLM 上下文
  token_budget_for_plan: 500            # 计划注入的 token 预算
  plan_file_persistence:
    enabled: true                       # 写入 task_plan.md 等文件
    directory: "./.agentos"             # 文件存放目录
    auto_read_plan_file: false          # LLM 显式读取计划文件

# ── V12 新增: verification ──
verification:
  enabled: true
  auto_run_tests: true                  # 自动运行 check_command
  require_llm_review: false             # 需要 LLM 审查
  max_retry_per_failed_criterion: 2     # 失败验收标准最多重试次数
  user_approval_required_for:           # 需要用户确认的验收类型
    - "security"
    - "deployment"
  allowed_check_commands:               # 白名单命令
    - "npm test"
    - "npm run lint"
    - "cargo test"
    - "go test"
    - "pytest"
  command_timeout_seconds: 120          # 命令超时

# ── V12 新增: pitfallTracking ──
pitfall_tracking:
  enabled: true
  max_pitfalls_in_context: 3            # 每次注入最多陷阱数
  auto_flag_on_hit: true                # 陷阱命中自动标记子任务
  feed_back_to_proto_task: true         # 命中反馈到 ProtoTask
  match_keyword_threshold: 2            # 陷阱匹配最少关键词数
  hits_before_flag: 2                   # 同一子任务命中次数阈值
  auto_downgrade_misrate: 0.3           # 误报率超过此值自动降 severity

# ── V12 修改: midSessionLearner (从 boolean 升级为 struct) ──
mid_session_learner:
  enabled: true
  detect_user_correction: true
  detect_tool_pattern_violation: true
  detect_subtask_completion: true       # [新 V12] 检测完成信号
  correction_confidence_penalty: 0.2
  max_adjustments_per_session: 5
  feed_to_inner_loop: true              # [新 V12] 发送检测到编排器

# ── V12 移除 ──
# knowledge_query: ...                  # 内部化
# cognitive_guidance: ...               # 嵌入计划
# guidance_signals: ...                 # 嵌入计划

# ── V10/V11 保留 ──
# taskContext, protoTask, outcomeFeedback (internalized),
# contextPressure, sceneRecognition, verification, ... 
```

---

## 五、AgentOS 自身的自主权边界（V12 重新界定）

V11 的立场：
- ❌ 触发任务分解——那是 planning-with-files 的事
- ❌ 启动/管理子 Agent——那是 OpenClaw 的事  
- ✅ 生成 GuidanceSignal（基于已有数据）
- ✅ 处理 OutcomeFeedback（置信度算法）
- ✅ 检测实时矛盾（规则匹配）

V12 的立场：
- ✅ **生成任务计划**（基于 ProtoTask → 这是从已有知识推导，不是决策）
- ✅ **管理子任务状态机**（确定性状态转换，不是决策）
- ✅ **运行验收检查**（确定性标准匹配，不是决策）
- ✅ **监控陷阱命中**（模式匹配 + 历史对比，不是决策）
- ❌ 替代 LLM 推理（LLM 仍然做代码/内容工作）
- ❌ 替代用户决策（用户仍然决定"做什么任务"）
- ❌ 替代 OpenClaw 执行工具（工具调用仍在 OpenClaw 中）

**V12 仍然不"做决策"——但它现在"管理任务的结构"。这就像项目经理 vs 工程师：AgentOS 管理任务的结构（阶段、子任务、验收标准），LLM 和 OpenClaw 做具体的执行工作。**

---

## 兄弟文件

- [What is AgentOS V12?](what-is.md) — V12 的工程定义
- [Why AgentOS V12?](why.md) — 第一性原理：为什么 V11 的边界是错的
- [How does it work?](how.md) — 六个模块的完整实现
- [When does it operate?](when.md) — 6 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V11 基础 + 6 新增 - 3 移除）
- [Architecture Design](design.md) — 技术规格与 API 契约
