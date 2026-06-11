# AgentOS V4 Architecture Design

> 版本：v4 (Process Model + Role Coordination + Momentum Engine)
> 状态：设计阶段
> 基于：V3 多维主动学习架构 + 过程模型缺口分析 (2026-06-11)

---

## 一、架构总览

### V4 核心命题

**V3 让 AgentOS 知道了"学什么"和"自己缺什么"。

V4 让 AgentOS 知道"下一步该干什么"——不是下一步该调哪个工具，而是下一步该推动什么、找谁推动、怎么推动、卡住了怎么办。**

### V4 集成架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                              │
│                                                                      │
│  Channels: Telegram · 飞书 · 邮件 · Discord · Slack · ...          │
│       ▲                         ▲                                    │
│       │ 用户消息                 │ 协作者消息 (PM/架构师/...)       │
│       │ 任务分配/教导/纠正       │ 确认/拒绝/修改意见               │
│       │                         │                                    │
│       ▼                         ▼                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    OpenClaw Agent Runtime                       │  │
│  │                                                                  │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │               AgentOS Memory Plugin (V4)                   │  │  │
│  │  │                                                             │  │  │
│  │  │  ┌─────────────────────────────────────────────────────┐  │  │  │
│  │  │  │ Hook Handlers (7 hooks)                              │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │ session_start     → load_context + active_processes  │  │  │  │
│  │  │  │ message_received  → analyze + collaborator_detect    │  │  │  │
│  │  │  │ before_tool_call  → autonomy_check                   │  │  │  │
│  │  │  │ after_tool_call   → capture_feedback                 │  │  │  │
│  │  │  │ agent_end         → learning + step_verify + process │  │  │  │
│  │  │  │ session_end       → reflect + process_snapshot       │  │  │  │
│  │  │  │ cron_tick         → scan_active_processes  ← V4 NEW  │  │  │  │
│  │  │  └──────────────────────┬──────────────────────────────┘  │  │  │
│  │  │                         │                                  │  │  │
│  │  │  ┌──────────────────────┴──────────────────────────────┐  │  │  │
│  │  │  │              AgentOS Core Engine (V4)                │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │  ┌────────────────────────────────────────────┐     │  │  │  │
│  │  │  │  │ V4 NEW: Process Engine                     │     │  │  │  │
│  │  │  │  │  • ProcessTemplate → ProcessInstance       │     │  │  │  │
│  │  │  │  │  • Step state machine (pending→...→done)   │     │  │  │  │
│  │  │  │  │  • Gate conditions (entry/exit)            │     │  │  │  │
│  │  │  │  │  • Timeout + dependency tracking           │     │  │  │  │
│  │  │  │  └────────────────────────────────────────────┘     │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │  ┌────────────────────────────────────────────┐     │  │  │  │
│  │  │  │  │ V4 NEW: Role Model                         │     │  │  │  │
│  │  │  │  │  • RoleRegistry (multi-role profiles)      │     │  │  │  │
│  │  │  │  │  • Communication preferences + response    │     │  │  │  │
│  │  │  │  │  • Interaction history + strategy learning │     │  │  │  │
│  │  │  │  │  • Role relationship graph                 │     │  │  │  │
│  │  │  │  └────────────────────────────────────────────┘     │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │  ┌────────────────────────────────────────────┐     │  │  │  │
│  │  │  │  │ V4 NEW: Momentum Engine                    │     │  │  │  │
│  │  │  │  │  • Blockage → Strategy (wait/nudge/esc/...)│     │  │  │  │
│  │  │  │  │  • Communication draft + role adaptation   │     │  │  │  │
│  │  │  │  │  • Cadence management (not too much/little)│     │  │  │  │
│  │  │  │  └────────────────────────────────────────────┘     │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │  ┌────────────────────────────────────────────┐     │  │  │  │
│  │  │  │  │ V4 NEW: Action Verification Loop           │     │  │  │  │
│  │  │  │  │  • Step decision verification              │     │  │  │  │
│  │  │  │  │  • Role routing verification               │     │  │  │  │
│  │  │  │  │  • Communication effectiveness             │     │  │  │  │
│  │  │  │  │  • Process efficiency feedback             │     │  │  │  │
│  │  │  │  └────────────────────────────────────────────┘     │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │  V3 保留的六层: L6 自主决策 / L5 六维能力模型       │  │  │  │
│  │  │  │  L4 学习闭环+Curiosity / L3 五类知识 /              │  │  │  │
│  │  │  │  L2 任务编排 / L1 工具熟练度                        │  │  │  │
│  │  │  └──────────────────────┬──────────────────────────────┘  │  │  │
│  │  │                         │                                  │  │  │
│  │  │  ┌──────────────────────┴──────────────────────────────┐  │  │  │
│  │  │  │         AgentMemory MCP Client (V4 expanded)        │  │  │  │
│  │  │  └─────────────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                                                                  │  │
│  │  OpenClaw Tool Execution + Multi-Channel Messaging               │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│  ┌─────────────────────────────────┼──────────────────────────────┐  │
│  │              AgentMemory (via MCP)                               │  │
│  │  V4 新增: ProcessTemplate / ProcessInstance / ProcessStep       │  │
│  │  V4 新增: RoleModel / InteractionHistory                        │  │
│  │  V4 新增: MomentumDecision / ActionVerification                 │  │
│  │  V3 保留: CompetencyModel (6D) / 5 knowledge types / 5 lessons  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│  ┌─────────────────────────────────┼──────────────────────────────┐  │
│  │                    External World                                │  │
│  │  协作者: PM 张三 · 架构师李四 · 开发经理王五 · 测试赵六        │  │
│  │  工具: MCP Servers · REST APIs · Browser · Terminal             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、V4 核心数据模型

### 2.1 ProcessTemplate（流程模板）

```yaml
ProcessTemplate:
  template_id: string                # "software_development"
  name: string                       # "软件开发流程"
  version: int                       # 3（从实际执行中优化而来）
  
  description: string
  applicable_domains: string[]       # ["software", "module_delivery"]
  trigger_patterns: string[]         # ["开发", "做模块", "写代码", "实现"]
  
  steps:                             # 有序步骤列表
    - step_id: "requirements"
      name: "需求分析"
      order: 1
      type: "delegated"              # self | delegated | collaborative
      default_assignee_role: "product_manager"
      
      entry_conditions:
        - "任务已分配并确认"
        - "项目上下文已就绪"
      
      exit_conditions:
        - "PRD 文档经 PM 确认"
        - "需求范围明确（无待澄清项）"
      
      wait_policy:
        reasonable_wait: "3 天"
        nudge_threshold: "5 天"
        escalation_threshold: "10 天"
        max_nudges: 2
      
      inputs: ["客户原始需求", "项目背景"]
      outputs: ["PRD 文档", "需求确认记录"]
      depends_on: []                 # 无依赖（第一步）
    
    - step_id: "architecture"
      name: "架构设计"
      order: 2
      type: "delegated"
      default_assignee_role: "architect"
      depends_on: ["requirements"]
      entry_conditions:
        - "PRD 已确认"
      exit_conditions:
        - "技术方案文档已完成"
        - "架构师确认方案"
      wait_policy:
        reasonable_wait: "5 天"
        nudge_threshold: "8 天"
        escalation_threshold: "14 天"
        max_nudges: 3
      inputs: ["PRD 文档"]
      outputs: ["技术方案文档"]
    
    - step_id: "scheduling"
      name: "开发排期"
      order: 3
      type: "delegated"
      default_assignee_role: "dev_manager"
      depends_on: ["architecture"]
      # ...
    
    - step_id: "implementation"
      name: "编码实现"
      order: 4
      type: "self"
      depends_on: ["scheduling"]
      tools: ["code_editor", "git", "terminal"]
      # ...
    
    - step_id: "testing"
      name: "测试验证"
      order: 5
      type: "delegated"
      default_assignee_role: "tester"
      depends_on: ["implementation"]
      # ...
    
    - step_id: "acceptance"
      name: "验收交付"
      order: 6
      type: "collaborative"
      participants: ["user", "client"]
      depends_on: ["testing"]
      # ...
  
  # 从实际执行中学到的优化
  learned_optimizations:
    - version: 2
      after_instance_count: 5
      changes:
        - "在 implementation 前增加 scheduling 步骤"
        - "缩短 architecture 步骤的 reasonable_wait（架构师实际平均 4 天回复）"
    - version: 3
      after_instance_count: 10
      changes:
        - "testing 步骤前增加 self_test 子步骤"
        - "acceptance 分为 pm_preview → client_formal 两个子步骤"
  
  metrics:                           # 模板级别的统计
    avg_duration: "18 天"
    success_rate: 0.85
    common_bottlenecks: ["architecture", "acceptance"]
    template_maturity: 0.75          # 0-1: 模板经过多少实例验证
```

### 2.2 ProcessInstance（流程实例）

```yaml
ProcessInstance:
  instance_id: string                # "proc_20260611_001"
  template_id: string                # "software_development"
  template_version: int              # 3
  
  context:                           # 流程实例上下文
    project: "膜力云智慧水务"
    module: "用户管理"
    goal: "用户管理模块开发完成并验收通过"
    deadline: "2026-07-15"
    priority: "high"
  
  status: "in_progress"              # pending | in_progress | completed | abandoned
  
  current_step_index: 2              # 当前在第几步（0-based）
  
  steps:                             # 实例化后的步骤状态
    - step_id: "requirements"
      order: 1
      type: "delegated"
      assignee: "pm_zhang"           # 从 RoleRegistry 解析
      
      status: "completed"            # pending → ready → in_progress → completed
      status_history:
        - {status: "ready", timestamp: "2026-06-11 10:00"}
        - {status: "in_progress", timestamp: "2026-06-11 10:05"}
        - {status: "waiting", timestamp: "2026-06-11 10:05"}
        - {status: "completed", timestamp: "2026-06-18 15:00"}
      
      nudge_history:
        - {timestamp: "2026-06-16 10:00", type: "light", result: "replied_2_days_later"}
      
      started_at: "2026-06-11 10:00"
      completed_at: "2026-06-18 15:00"
      outputs: ["PRD_v2.md"]
      verification:
        step_decision_correct: true
        role_routing_correct: true
        timing_quality: 0.8
        communication_quality: 0.85
    
    - step_id: "architecture"
      order: 2
      type: "delegated"
      assignee: "architect_li"
      
      status: "waiting"              # ← 当前卡在这一步
      status_history:
        - {status: "ready", timestamp: "2026-06-18 15:01"}
        - {status: "in_progress", timestamp: "2026-06-18 15:05"}
        - {status: "waiting", timestamp: "2026-06-18 15:05"}
      
      nudge_history: []              # 还没催过
      last_status_change: "2026-06-18 15:05"
      inputs: ["PRD_v2.md"]
    
    # ... 其余步骤 status: "pending"
  
  timeline:
    created_at: "2026-06-11 10:00"
    estimated_completion: "2026-07-05"
    actual_completion: null
  
  history:                           # 重大事件记录
    - {timestamp: "2026-06-11", event: "created"}
    - {timestamp: "2026-06-18", event: "step_completed", step: "requirements", duration: "7 天"}
    - {timestamp: "2026-06-22", event: "nudge_triggered", step: "architecture", reason: "超过 nudge_threshold"}
```

### 2.3 Role（角色模型）

```yaml
Role:
  role_id: string                    # "pm_zhang"
  type: "collaborator"               # owner | collaborator | stakeholder
  name: "张三"
  title: "产品经理"
  projects: ["膜力云智慧水务"]
  
  identity:
    channels:                        # 可触达渠道
      - channel: "飞书"
        address: "zhangsan@feishu"
        is_primary: true
      - channel: "email"
        address: "zhangsan@company.com"
        is_primary: false
  
  communication:
    preference: "direct_async"       # direct_async | formal_async | quick_sync | detail_oriented
    style:
      greeting: "casual"
      brevity: "high"                # 偏好简短（0-1）
      needs_full_context: false      # 不需要每次都提供完整上下文
      sensitive_to_tone: false       # 对催促语气不敏感
      preferred_language: "zh-CN"
    
    response_profile:
      avg_response_time_hours: 36    # 平均 1.5 天
      peak_windows: ["周二 14:00-17:00", "周四 14:00-17:00"]
      dead_zones: ["周一 08:00-12:00", "周五 16:00-20:00"]
      silence_threshold_hours: 120   # 5 天没回 = 异常
    
    nudge_profile:                   # 从互动历史中学习
      tolerance: "medium"            # high | medium | low | none
      effective_timing: "上午 10:00"
      effective_tone: "casual_reminder"
      effective_channel: "飞书"
      max_nudges_before_annoyed: 3
      escalation_response: "positive"
  
  relationships:                     # 与其他角色的关系
    - related_role: "user"
      relationship: "managed_by"     # 向用户汇报
    - related_role: "architect_li"
      relationship: "peer"
    - related_role: "dev_manager_wang"
      relationship: "influences"     # PM 影响开发经理的排期
  
  current_status:
    load: "high"
    availability: "limited"
    last_interaction: "2026-06-18"
    open_requests: ["膜力云-用户管理模块 PRD 确认"]
    mood_indicators: null
  
  interaction_history:
    total_requests: 15
    response_rate: 0.87              # 13/15 次有回复
    avg_satisfaction: 0.8
    recent_interactions:
      - {date: "2026-06-18", type: "step_feedback", outcome: "positive"}
      - {date: "2026-06-06", type: "nudge", outcome: "replied_next_day"}
      - {date: "2026-05-20", type: "nudge", outcome: "no_response"}
      - {date: "2026-05-08", type: "escalation", outcome: "resolved_by_user"}
  
  lessons_learned:                   # 从互动中学到的沟通技巧
    - "发 PRD 前附上要点摘要（他不看长文）"
    - "周四下午联系回复最快"
    - "不要在周一上午发任何请求"
    - "催办时加 '🙏' 比不加的效果好"
```

### 2.4 MomentumDecision（推动决策记录）

```yaml
MomentumDecision:
  decision_id: string
  timestamp: datetime
  process_instance_id: string
  step_id: string
  
  context:
    wait_duration_hours: 120        # 已经等了多久
    nudge_count_so_far: 0
    assignee: "architect_li"
    step_type: "delegated"
    process_urgency: 0.6             # deadline 剩余时间比例
  
  decision:
    action: "nudge"                  # wait | nudge | escalate | bypass | abandon
    level: "light"                   # light | moderate | firm
    reasoning: "超过 nudge_threshold (96h)，已等 120h，角色容忍度 medium，第一次催办"
  
  message:
    channel: "email"
    content: "李四，用户管理模块的技术方案方便的时候看看？PRD 已确认，三个技术选型需要你的意见。不急～"
    adaptation:                      # 如何适配了角色
      tone: "casual"
      brevity: "high"
      context_included: true
  
  outcome:                           # 填写于结果明确后
    result: "replied"                # replied | ignored | annoyed | escalated_by_user
    response_time_hours: 48
    quality: "positive"              # positive | neutral | negative
    follow_up_needed: false
  
  learning:                          # 更新到 Role.nudge_profile
    effective: true
    timing_confirmed: true
    tone_confirmed: true
    suggestions: null
```

### 2.5 ActionVerification（新学习事件类型 V4）

```yaml
ActionVerification:
  verification_id: string
  timestamp: datetime
  
  # ─── 类型六：步骤决策验证（V4 新增）───
  # type: "step_decision_verification"
  # process_instance_id: string
  # step_id: string
  # decision: "选择进入架构设计步骤"
  # was_correct: true
  # evidence: "流程顺利推进，架构师接受请求"
  # alternative_considered: "先找开发经理排期（被流程模板排除了）"
  
  # ─── 类型七：角色路由验证（V4 新增）───
  # type: "role_routing_verification"
  # target_role: "pm_zhang"
  # was_correct: true
  # evidence: "张三确认这是他的职责范围"
  
  # ─── 类型八：时机验证（V4 新增）───
  # type: "timing_verification"
  # action: "nudge"
  # wait_duration_before_action: "120h"
  # was_optimal: false
  # evidence: "协作者 2 小时内就回复了 → 催晚了"
  # suggested_adjustment: "该角色 reasonable_wait 从 5 天缩短为 3 天"
  
  # ─── 类型九：沟通适配验证（V4 新增）───
  # type: "communication_verification"
  # role: "pm_zhang"
  # message_style: "casual_reminder"
  # was_effective: true
  # evidence: "正面回应，没有不满情绪"
  
  # ─── 类型十：流程效率验证（V4 新增）───
  # type: "process_efficiency_verification"
  # process_instance_id: string
  # total_duration: "18 天"
  # compared_to_avg: "-4 天（快 18%）"
  # bottlenecks: ["架构设计等了 7 天（最长的等待）"]
  # optimization_suggestions:
  #   - "架构步骤的 reasonable_wait 从 5 天缩短为 3 天"
  #   - "开发与测试之间增加开发自测步骤（减少返工）"
```

### 2.6 V4 能力模型（从四维扩展到六维）

```yaml
CompetencyModel:
  # ── V3 原有的四维 ──
  tool_skills: {...}
  domain_familiarity: {...}
  task_type_proficiency: {...}
  user_model_confidence: {...}

  # ── V4 新增的二维 ──

  # 维度五：过程管理能力
  process_management:
    templates_mastered:               # 掌握的流程模板
      - template: "software_development"
        mastery: 0.75
        instances_completed: 10
        avg_completion_time: "18 天"
        on_time_rate: 0.80
      - template: "document_ingestion"
        mastery: 0.55
        instances_completed: 5
      
    step_routing_accuracy: 0.85      # "下一步该干什么"的准确率
    bottleneck_prediction: 0.45      # 提前预测哪个步骤会卡住的能力
    dependency_management: 0.60      # 管理多步骤依赖的能力
  
  # 维度六：行动可靠性
  action_reliability:
    role_identification_accuracy: 0.90  # "该找谁"判断准确率
    communication_effectiveness: 0.72   # "怎么说"的有效率
    timing_appropriateness: 0.68        # 推动时机合适率（不太早不太晚）
    escalation_accuracy: 0.80           # 升级决策正确率
    nudge_success_rate: 0.65            # 催办成功率
    
    verification_coverage: 0.50         # 多少行动被事后验证
    false_positive_rate: 0.05           # 不必要升级/催办的比例
```

---

## 三、Process Engine 详细设计

### 3.1 步骤状态机

```
                    ┌─────────┐
                    │ pending │ ← 初始状态（依赖未满足）
                    └────┬────┘
                         │ 依赖满足 + 入口条件检查通过
                         ▼
                    ┌─────────┐
                    │  ready  │ ← 可以开始，但还没启动
                    └────┬────┘
                         │ 流程引擎激活步骤
                         ▼
              ┌──────────────────┐
              │   in_progress    │
              └───┬──────┬───────┘
                  │      │
        type="self"│      │ type="delegated" / "collaborative"
                  │      │ (发起请求给协作者)
                  ▼      ▼
              ┌──────┐ ┌──────────┐
              │ done │ │ waiting  │ ← 等待协作者响应
              └──────┘ └────┬─────┘
                            │ 协作者响应 → 检查出口条件
                            ├── 条件满足 ──▶ completed
                            ├── 需要修改 ──▶ in_progress (循环)
                            ├── 超时 ──────▶ Momentum Engine
                            └── 被拒绝 ────▶ blocked
                                               │
                                               ▼
                                          Momentum Engine:
                                          escalate / bypass / abandon
```

### 3.2 步骤状态流转触发条件

```typescript
interface StepStateTransition {
  from: StepStatus;
  to: StepStatus;
  trigger: 
    | "dependency_met"           // 依赖步骤完成
    | "entry_conditions_met"     // 入口条件全部满足
    | "step_activated"           // 流程引擎启动步骤
    | "request_sent"             // 协作请求已发送
    | "collaborator_responded"   // 协作者回复
    | "exit_conditions_met"      // 出口条件满足
    | "timeout_exceeded"         // 超时
    | "user_override"            // 用户手动跳转
    | "collaborator_rejected"    // 协作者拒绝
    | "process_abandoned";       // 流程被放弃
}
```

---

## 四、Momentum Engine 详细设计

### 4.1 决策矩阵

```yaml
# 决策矩阵: 横轴 = 等待时间层级, 纵轴 = 角色类型 + 历史

momentum_decision_matrix:
  
  # ── 等待时间层级 ──
  time_levels:
    - level: "normal"
      condition: "T < reasonable_wait"
      default_action: "wait"
      
    - level: "concern"
      condition: "T >= reasonable_wait AND T < nudge_threshold"
      default_action: "mark_attention"
      
    - level: "overdue"
      condition: "T >= nudge_threshold AND T < escalation_threshold"
      default_action: "nudge"
      
    - level: "critical"
      condition: "T >= escalation_threshold"
      default_action: "escalate"
  
  # ── 角色类型修正 ──
  role_modifiers:
    - role_tolerance: "high"        # 角色对催促容忍度高
      modifiers:
        reasonable_wait: ×1.3        # 多等 30%
        nudge_threshold: ×1.3
        nudge_tone: "casual"
    
    - role_tolerance: "low"         # 角色容易烦
      modifiers:
        reasonable_wait: ×1.0
        nudge_threshold: ×0.8       # 更早催（因为催了可能不理）
        max_nudges: 1                # 最多催 1 次 → 直接升级
        nudge_tone: "very_casual"
    
    - role_tolerance: "none"        # 完全不能催
      modifiers:
        nudge_action: "skip"        # 跳过催办，直接升级给用户
        escalation_channel: "user_only"
  
  # ── 流程紧急度修正 ──
  urgency_modifiers:
    - urgency: "high" (deadline 在 1 周内)
      modifiers:
        all_thresholds: ×0.5        # 所有等待期减半
    - urgency: "low" (无明确 deadline)
      modifiers:
        all_thresholds: ×1.5        # 所有等待期延长 50%
```

### 4.2 沟通草稿生成

```
MomentumEngine.generateMessage():

  Input:
    • action: "nudge" | "escalate" | "bypass" | "abandon"
    • step: ProcessStep
    • assignee: Role
    • wait_context: {duration, nudge_count, urgency}
  
  Prompt to LLM:
    """
    你需要以 AgentOS 的身份向 {assignee.name} 发送一条关于 {step.name} 的 {action} 消息。
    
    上下文:
    - 你在推进 {process.goal}
    - {step.name} 步骤已等候 {wait_context.duration}
    - 这是第 {wait_context.nudge_count + 1} 次联系
    
    角色沟通偏好:
    - 渠道: {assignee.communication.preference}
    - 简洁度: {assignee.communication.style.brevity}（0=详细，1=极简）
    - 正式度: {assignee.communication.style.greeting}
    - 语气敏感度: {assignee.communication.style.sensitive_to_tone}
    
    历史教训:
    {assignee.lessons_learned}
    
    要求:
    - {action == "nudge"} → 轻提醒，不带压力
    - {action == "escalate"} → 这是发给用户的升级通知，附上等待历史
    - 语气适配角色画像
    - 包含必要的上下文（但遵从简洁度偏好）
    """
```

---

## 五、AgentMemory 集成映射（V4 新增）

### 5.1 Slot 存储（V4 新增）

| AgentOS 数据 | AgentMemory 调用 | 频率 |
|-------------|-----------------|------|
| Active ProcessInstances | `memory_slot_get/set "active_processes"` | session_start 读, 状态变更时写 |
| ProcessTemplates | `memory_slot_get/set "process_templates"` | session_start 读, 模板更新时写 |
| RoleRegistry | `memory_slot_get/set "role_registry"` | session_start 读, 角色更新时写 |
| MomentumConfig | `memory_slot_get/set "momentum_config"` | session_start 读 |
| CompetencyModel (6D) | `memory_slot_get/set "competency_model"` | 同 V3 |

### 5.2 Memory 存储（V4 新增类型）

| AgentOS 数据 | AgentMemory type | 频率 |
|-------------|-----------------|------|
| ProcessInstance (archived) | `memory_save(type="process_instance")` | 流程完成后归档 |
| ProcessTemplate (versioned) | `memory_save(type="process_template", supersedes=...)` | 模板优化时 |
| Role profile snapshots | `memory_save(type="role_snapshot")` | 画像重大变更时 |
| MomentumDecision | `memory_save(type="momentum_decision")` | 每次推动动作后 |
| ActionVerification | `memory_save(type="action_verification")` / `memory_lesson_save` | 步骤/流程完成后 |

### 5.3 Lesson 存储（V4 新增事件类型）

| 学习事件类型 | AgentMemory 调用 | V3 | V4 |
|------------|-----------------|----|----|
| step_decision_verification | `memory_lesson_save` | ❌ | ✅ |
| role_routing_verification | `memory_lesson_save` | ❌ | ✅ |
| timing_verification | `memory_lesson_save` | ❌ | ✅ |
| communication_verification | `memory_lesson_save` | ❌ | ✅ |
| process_efficiency_verification | `memory_lesson_save` | ❌ | ✅ |
| (V3 的 5 种类型) | `memory_lesson_save` | ✅ | ✅ |

---

## 六、Hook 注册（V4 更新）

```typescript
function registerHooks(): PluginHookRegistration[] {
  return [
    { hook: "session_start",      handler: onSessionStart,      priority: "high" },
    { hook: "message_received",   handler: onMessageReceived,   priority: "high" },   // V4 扩展
    { hook: "before_tool_call",   handler: onBeforeToolCall,    priority: "normal" },
    { hook: "after_tool_call",    handler: onAfterToolCall,     priority: "normal" },
    { hook: "agent_end",          handler: onAgentEnd,          priority: "normal" },  // V4 扩展
    { hook: "session_end",        handler: onSessionEnd,        priority: "low" },     // V4 扩展
    // V4 新增: cron_tick — 通过 OpenClaw cron job 注册而非 plugin hook
  ];
}

// V4 新增: cron job 注册
function registerCronJobs(): CronJobRegistration[] {
  return [
    {
      name: "agentos_process_scanner",
      schedule: { kind: "every", everyMs: 4 * 3600 * 1000 },  // 每 4 小时
      handler: onCronTick,
    },
  ];
}
```

---

## 七、会话内缓存策略（V4 扩展）

V3 的缓存策略扩展为加载 V4 的新数据结构：

```
session_start 加载:
  competencyModel (6D)    ← memory_slot_get("competency_model")
  autonomyPolicy          ← memory_slot_get("autonomy_policy")
  toolRegistry            ← memory_slot_get("tool_registry")
  userModel               ← memory_slot_get("user_model")
  curiosityConfig         ← memory_slot_get("curiosity_config")
  momentumConfig          ← memory_slot_get("momentum_config")           ← V4 新增
  activeProcesses         ← memory_slot_get("active_processes")          ← V4 新增
  processTemplates        ← memory_slot_get("process_templates")         ← V4 新增
  roleRegistry            ← memory_slot_get("role_registry")             ← V4 新增
  activeGaps / domains / mentalState  ← (V3 原有)

session 期间:
  所有查询命中 in-memory cache
  process state changes: in-memory（频繁更新）
  knowledge search: 按需调用 MCP

agent_end:
  批量写入 learning events (10 种类型: V3 5 种 + V4 5 种)
  更新 process step 状态（如有变更）
  存储 momentum_decisions（如有推动动作）
  Action Verification（步骤/流程验证）
  更新 competency_model (6D)
  更新 role 互动历史

session_end:
  最终 flush
  active_processes 状态快照 → slot
  process_efficiency 对比分析
  Curiosity Engine 最终扫描
  ProcessTemplate 优化提案（如有）
  mental_state 保存
```

---

## 八、V4 范围边界

### V4 包含

| 组件 | 优先级 | 说明 |
|------|--------|------|
| Process Engine | P0 | 流程模板、实例管理、步骤状态机、门控条件 |
| ProcessTemplate v1 预置模板 | P0 | 软件开发流程、文件摄入流程、周报制作流程 |
| Role Model + RoleRegistry | P0 | 多角色画像、沟通偏好、互动历史、关系图 |
| Momentum Engine | P0 | 阻塞检测 → 策略决策 → 沟通草稿 → 发送追踪 |
| Action Verification Loop | P0 | 五种新 LearningEvent 类型 |
| cron_tick 定期扫描 | P1 | 时间驱动的流程阻塞检测 |
| MomentumConfig + 治理 | P1 | 频率/时机/角色容忍度/升级路径 |
| `/agentos processes/roles/momentum/templates` | P1 | 新增用户命令 |
| 流程效率统计 | P2 | 跨实例对比 + 瓶颈分析 |
| ProcessTemplate 自主优化 | P2 | 从 ActionVerification 中学习模板优化 |

### V4 明确排除

| 组件 | 说明 | 目标版本 |
|------|------|---------|
| 复杂的流程分支/条件逻辑 | V4 的流程模板是线性的（有顺序依赖但不含 if/else 分支） | V5 |
| 跨项目的资源冲突检测 | 多个流程争抢同一个角色 | V5 |
| 协作者负载均衡 | 自动感知协作者忙碌程度并调整路由 | V5 |
| 自然语言流程挖掘 | 从用户描述中自动提取完整流程模板 | V5 |
| 自动发现新角色 | 从通信中自动识别和创建角色画像 | V5 |
| 外部日历集成 | 从协作者日历中自动感知可用性 | V6 |
| 多用户协作冲突 | 两个用户通过各自的 AgentOS 实例协调同一个项目 | V6 |

### V1 → V2 → V3 → V4 完整差异

| 维度 | V1 | V2 | V3 | V4 |
|------|----|----|----|----|
| 运行环境 | Claude Code Harness | OpenClaw Plugin | 同 V2 | 同 V2 |
| 任务模型 | 工具链 | 工具链 | 工具链 | **过程网络** |
| 角色认知 | 无 | 用户（隐式） | UserModel | **RoleRegistry** |
| 能力维度 | 工具 1D | 工具 1D | 4D | **6D** |
| 知识类型 | 无分类 | 无分类 | 5 类 | 5 类（不变） |
| 学习事件 | 1 种 | 1 种 | 5 种 | **10 种** |
| Hook 数 | 自建 | 5 | 6 | **7** |
| 学习触发 | 被动 | 被动 | 被动+主动 | 被动+主动+**时间**+**过程** |
| 核心创新 | 学习闭环 | 正确载体 | 多维学习+主动好奇 | **过程模型+角色协调** |

---

## 九、兄弟文件

- [What is AgentOS V4?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 角色扩展
- [Why AgentOS V4?](why.md) — 为什么需要过程模型
- [How does it work?](how.md) — 四个新子系统详解
- [When does it operate?](when.md) — 过程生命周期
- [Where does it sit?](where.md) — 架构定位
