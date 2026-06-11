# Praxis V3 Architecture Design

> 版本：v3 (Multi-Dimensional Learning + Proactive Curiosity)
> 状态：设计阶段
> 基于：V2 集成架构 + 多维学习缺口分析 (2026-06-11)

---

## 一、架构总览

### V3 核心命题

**V2 解决了"在哪里运行"** → OpenClaw Memory Plugin + AgentMemory MCP

**V3 解决了"学什么 + 谁发起"** → 四维能力模型 + Curiosity Engine 主动学习

### V3 集成架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                              │
│                                                                      │
│  Channels: Telegram · Discord · Slack · WhatsApp · Signal · CLI ... │
│       ▲                                                              │
│       │ 用户消息（教导/纠正/分配任务）                                │
│       │ Praxis 主动提问（择机/批量/治理） ← V3 新增                │
│       ▼                                                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    OpenClaw Agent Runtime                       │  │
│  │                                                                  │  │
│  │  Agent Loop:                                                     │  │
│  │  User Input → LLM → Tool Calls → Results → Response             │  │
│  │       │               │              │            │              │  │
│  │       ▼               ▼              ▼            ▼              │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │               Praxis Memory Plugin (V3)                   │  │  │
│  │  │                                                             │  │  │
│  │  │  ┌─────────────────────────────────────────────────────┐  │  │  │
│  │  │  │ Hook Handlers (6 core hooks)                         │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │ session_start ──────▶ load_context()                 │  │  │  │
│  │  │  │ message_received ───▶ analyze_intent()    ← V3 NEW   │  │  │  │
│  │  │  │ before_tool_call ──▶ autonomy_check()                │  │  │  │
│  │  │  │ after_tool_call ───▶ capture_feedback()              │  │  │  │
│  │  │  │ agent_end ─────────▶ learning_loop() + reflect()     │  │  │  │
│  │  │  │ session_end ───────▶ reflect_and_save() + audit()    │  │  │  │
│  │  │  └──────────────────────┬──────────────────────────────┘  │  │  │
│  │  │                         │                                  │  │  │
│  │  │  ┌──────────────────────┴──────────────────────────────┐  │  │  │
│  │  │  │              Praxis Core Engine (V3)                │  │  │  │
│  │  │  │                                                      │  │  │  │
│  │  │  │  L6  AutonomyEngine     • tool autonomy + question   │  │  │  │
│  │  │  │                           autonomy ← V3 扩展         │  │  │  │
│  │  │  │  L5  CompetencyManager  • 4D: tool + domain +       │  │  │  │
│  │  │  │                           task + user ← V3 核心变化  │  │  │  │
│  │  │  │  L4  LearningEngine     • tool learning + semantic   │  │  │  │
│  │  │  │                           learning + task reflection │  │  │  │
│  │  │  │                         • Curiosity Engine ← V3 新增 │  │  │  │
│  │  │  │  L3  KnowledgeManager   • 5-type taxonomy +          │  │  │  │
│  │  │  │                           gap tracking ← V3 核心变化 │  │  │  │
│  │  │  │  L2  TaskTracker        • trace + pattern            │  │  │  │
│  │  │  │                           recognition ← V3 扩展      │  │  │  │
│  │  │  │  L1  ToolProficiencyMgr • metadata + proficiency     │  │  │  │
│  │  │  │                           (unchanged)                │  │  │  │
│  │  │  └──────────────────────┬──────────────────────────────┘  │  │  │
│  │  │                         │                                  │  │  │
│  │  │  ┌──────────────────────┴──────────────────────────────┐  │  │  │
│  │  │  │         AgentMemory MCP Client                       │  │  │  │
│  │  │  │  • slots: competency_model, user_model, tool_registry│  │  │  │
│  │  │  │  • save: domain_knowledge, task_pattern, knowledge_gap│ │  │  │
│  │  │  │  • lessons: 5 LearningEvent types                    │  │  │  │
│  │  │  │  • search: multi-type knowledge retrieval            │  │  │  │
│  │  │  │  • crystallize / patterns / reflect                  │  │  │  │
│  │  │  └─────────────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                                                                  │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │              OpenClaw Tool Execution                       │  │  │
│  │  │  Native: Browser · Terminal · File System                 │  │  │
│  │  │  MCP Client → External MCP Servers                        │  │  │
│  │  │  Plugin Tools: Third-party OpenClaw plugins               │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    │                                  │
│  ┌─────────────────────────────────┼──────────────────────────────┐  │
│  │              AgentMemory (via MCP)                               │  │
│  │  • SQLite-backed knowledge graph + vector index                  │  │
│  │  • Slot storage: competency_model, user_model, tool_registry    │  │
│  │  • Memory storage: 5 knowledge types + 5 lesson types           │  │
│  │  • 4-layer consolidation pipeline                                │  │
│  │  • Mesh sync for multi-instance                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、核心数据模型

### 2.1 ToolProficiency（与 V2 相同）

```yaml
ToolProficiency:
  tool_id: string                    # "coffee_machine" / "ppt_generator"
  tool_name: string
  source: "openclaw_native" | "mcp_server" | "openclaw_plugin"
  proficiency: float                 # 0.0-1.0
  level: SkillLevel
  evidence: [{task_id, session_id, performance, timestamp}]
  feedback_interpreter: {success_signals, failure_signals, quality_indicators}
  risk: {physical_consequences, max_autonomy, confirm_required_for}
  known_failure_modes: [{pattern, occurrences, last_occurred, prevention}]
  user_preferences: object
  learning_timeline: [...]
```

### 2.2 TaskTrace（V3 扩展：新增任务级评估）

```yaml
TaskTrace:
  task_id: string
  started_at: datetime
  completed_at: datetime

  # V2 原有：工具调用追踪
  tool_calls:
    - tool_id: string
      action: string
      params: object
      timestamp: datetime
      autonomy_decision: string
      result: {status, details, matched_signal}
      learning_triggered: boolean

  # V3 新增：任务级评估
  task_reflection:
    goal_achieved: boolean
    user_feedback_sentiment: "positive" | "neutral" | "negative"
    user_feedback_details: string     # "图表部分满意，文字分析太浅"
    efficiency_score: float           # 实际步骤 / 理想步骤
    domain_involved: string[]         # ["膜力云智慧水务", "城乡数据平台"]
    candidate_pattern: string | null  # 是否匹配已知 TaskPattern

  summary:
    total_tool_calls: int
    success_rate: float
    new_learning_events: int          # V2: proficiency_changes → V3: 更通用
    affected_dimensions:              # V3 新增
      - dimension: "tool_skill"
        changes: [{tool_id, before, after}]
      - dimension: "domain_familiarity"
        changes: [{domain, before, after}]
      - dimension: "task_type_proficiency"
        changes: [{task_type, before, after}]
      - dimension: "user_model"
        changes: [{aspect, before, after}]
```

### 2.3 知识模型（V3 核心新增）

#### 2.3.1 领域知识 (DomainKnowledge)

```yaml
DomainKnowledge:
  domain_id: string                  # "membrane_cloud_smart_water"
  domain_name: string                # "膜力云智慧水务"
  familiarity: float                 # 0.0-1.0
  
  concepts:                          # 核心概念
    - term: "一期目标"
      definition: "实现制造管理、数据对接、...三个核心模块上线"
      learned_from: "session-abc"
      confidence: 0.9
    - term: "城乡数据平台对接"
      definition: "与城乡数据平台实现API级别的数据同步"
      learned_from: "user_explanation session-def"
      confidence: 0.85
  
  stakeholders:                      # 关键干系人
    - name: "迟君平"
      role: "项目推进负责人"
      relevance: "数据对接推进的主要决策者"
      communication_style: "正式，偏好邮件"
  
  projects:                          # 活跃项目
    - name: "膜力云一期"
      status: "开发阶段"
      phase: "UAT联调"
      timeline: "2026-Q2上线"
  
  constraints:                       # 领域约束
    - "数据对接必须在Q2完成，涉及上级考核"
    - "智慧水务接入方案需要商务变更审批"
  
  learning_sources:                  # 知识来源
    - {source: "user_explanation", session: "session-abc", timestamp: ...}
    - {source: "document_ingestion", file: "需求梳理.md", timestamp: ...}
```

#### 2.3.2 任务模式 (TaskPattern)

```yaml
TaskPattern:
  pattern_id: string                 # "progress_report_creation"
  pattern_name: string               # "周报/月报制作"
  
  triggers:                          # 什么触发这个模式
    - "周报"
    - "进度报告"
    - "月报"
    - "milestone report"
  
  typical_tool_chain:                # 典型工具链
    - step: 1
      tool: "data_fetcher"
      purpose: "从各数据源采集原始数据"
      typical_duration: "5min"
    - step: 2
      tool: "chart_generator"
      purpose: "生成图表（趋势图+对比图）"
    - step: 3
      tool: "ppt_generator"
      purpose: "组装演示文稿（模板：公司季度汇报）"
    - step: 4
      tool: "email_sender"           # 可选
      purpose: "发送给干系人审阅"
      optional: true
  
  common_pitfalls:                   # 常见陷阱
    - "数据未更新到最新日期 → 返工"
    - "图表配色与公司模板不一致"
    - "遗漏风险分析板块"
    - "文字过多，违反图表优先原则"
  
  success_patterns:                  # 已验证的成功模式
    - "先用数据摘要确认方向，再做详细PPT → 减少返工"
    - "风险分析放在第2页（进度之后、数据之前）→ 用户评价最高"
  
  user_preferences:                  # 任务级偏好
    template: "公司季度汇报模板.pptx"
    chart_style: "扁平化，三色系"
    text_density: "每页 ≤ 50 字"
    must_include: ["风险分析", "下周计划", "需要支持的事项"]
  
  occurrence_count: 5
  last_executed: datetime
  average_success_rate: 0.8
  evolution:                         # 模式如何形成的
    - version: 1
      changes: "初始模式（3步）"
      after_session: "session-001"
    - version: 2
      changes: "新增风险分析板块（用户纠正后）"
      after_session: "session-003"
```

#### 2.3.3 用户模型 (UserModel)

```yaml
UserModel:
  model_version: 3
  last_updated: datetime
  
  communication_preferences:
    detail_level: "summary_first"      # summary_first | full_detail | bullet_points
    formality: "professional"          # casual | professional | formal
    chart_vs_text: "chart_heavy"       # chart_heavy | balanced | text_heavy
    morning_style: "brief_commands"    # 早上偏好简短指令
    evening_style: "detailed_review"   # 晚上偏好详细审阅
  
  decision_patterns:
    - pattern: "escalation_when_blocked"
      description: "遇到外部依赖阻塞时倾向于升级施压"
      evidence_sessions: ["session-001", "session-005", "session-012"]
      confidence: 0.75
    - pattern: "data_before_decision"
      description: "做决策前要求先看数据，不做直觉判断"
      evidence_sessions: ["session-003", "session-008"]
      confidence: 0.60
  
  priority_signals:
    - signal: "提到'上级'/'领导'/'汇报'"
      interpretation: "高优先级，需加快响应速度"
      confidence: 0.85
    - signal: "提到'deadline'/'截止'/'这周'"
      interpretation: "紧急，可能需要加班完成"
      confidence: 0.80
    - signal: "提到'看看'/'试一下'/'随便'"
      interpretation: "探索性任务，非紧急，可以多尝试"
      confidence: 0.70
    - signal: "回复'嗯'/'行'/'好'"
      interpretation: "基本满意，但没细看（不要假设完全认可）"
      confidence: 0.55
  
  feedback_style:
    positive_signals: ["不错", "可以", "还行", "比上次好"]
    negative_signals: ["不对", "不是这样", "重点是", "你没理解"]
    silent_satisfaction: true          # 不说不代表不满意
    correction_style: "direct"         # direct | suggestive | polite
  
  current_status:                      # 用户当前状态（动态）
    busy_periods: ["周一上午", "周四下午"]
    recent_urgency: "medium"
    open_loops: ["等待城乡数据平台对接确认"]
```

#### 2.3.4 流程知识 + 工具知识

```yaml
ProceduralKnowledge:
  procedure_id: string
  name: string                       # "制作演示文稿的完整流程"
  steps: [{order, action, tool, precondition, expected_output}]
  cross_tool_dependencies: [{from_step, to_step, data_flow}]
  optimization_history: [{before, after, improvement, discovered_in}]

ToolKnowledge:
  # 与 V2 的 ToolProficiency.feedback_interpreter + known_failure_modes 一致
  # 独立存储为 typed memory 以便跨工具检索
  tool_id: string
  best_practices: string[]
  failure_modes: [{pattern, prevention}]
  tips: string[]
```

### 2.4 学习事件（V3 核心新增：从 1 种到 5 种）

```yaml
LearningEvent:
  event_id: string
  timestamp: datetime
  session_id: string
  task_id: string

  # ─── 类型一：错误纠正（V2 原有）───
  # type: "mistake_correction"
  # before: "忘记检查水量就开始冲泡"
  # after: "冲泡前自动检查 status()"
  # root_cause: "对咖啡机状态检查不够重视"
  # affected_skills: [{skill: "coffee-brewing", change: +0.1}]
  # prevention_strategy: "每次 brew() 前先调用 status()"

  # ─── 类型二：领域洞察（V3 新增）───
  # type: "domain_insight"
  # domain: "膜力云智慧水务"
  # trigger: "user_explanation" | "document_ingestion" | "pattern_recognition"
  # insight: "膜力云项目有三个数据源：城乡数据平台(API)、智慧水务(API)、制造管理(DB)"
  # affected_concepts: ["城乡数据平台对接", "智慧水务接入"]
  # source_quote: "用户原话或文档片段"
  # confidence: 0.9

  # ─── 类型三：偏好发现（V3 新增）───
  # type: "preference_discovery"
  # aspect: "communication_style" | "decision_pattern" | "priority_signal" | ...
  # trigger: "explicit_feedback" | "implicit_pattern" | "correction"
  # discovery: "用户偏好先看摘要再决定是否需要详细分析"
  # evidence_messages: ["msg-001", "msg-003"]
  # confidence: 0.7
  # previous_assumption: "(如果之前有错误假设)" 用户喜欢详细报告

  # ─── 类型四：任务模式识别（V3 新增）───
  # type: "task_pattern_recognition"
  # pattern_name: "progress_report_creation"
  # trigger: "recurring_structure" | "user_labeled"
  # evidence_tasks: ["task-001", "task-003", "task-005"]
  # extracted_pattern: TaskPattern
  # confidence: 0.8

  # ─── 类型五：流程优化（V3 新增）───
  # type: "procedural_optimization"
  # procedure: "制作周报"
  # before_workflow: "直接采集数据 → 图表 → PPT → 发送"
  # after_workflow: "先发摘要确认 → 采集数据 → 图表 → PPT → 发送"
  # improvement: "减少返工，用户满意度从 0.6 提升到 0.8"
  # discovered_via: "task_reflection task-004"
```

### 2.5 能力模型（V3 核心变化）

```yaml
CompetencyModel:
  version: 15
  last_updated: datetime
  scope: "work"                      # OpenClaw agent scope

  # 维度一：工具熟练度（V2 原有，不变）
  tool_skills:
    - tool_id: "coffee_machine"
      proficiency: 0.72
      level: "proficient"
      evidence_count: 87
    - tool_id: "ppt_generator"
      proficiency: 0.55
      level: "competent"
      evidence_count: 12
    - tool_id: "email_sender"
      proficiency: 0.30
      level: "novice"
      evidence_count: 5

  # 维度二：领域熟悉度（V3 新增）
  domain_familiarity:
    - domain: "膜力云智慧水务"
      familiarity: 0.45
      concepts_known: 12
      tasks_involved: 8
      active_gaps: 3
      growth_rate: 0.05/week
    - domain: "城乡数据平台"
      familiarity: 0.60
      concepts_known: 8
      tasks_involved: 3
      active_gaps: 2
    - domain: "国企项目管理"
      familiarity: 0.30
      concepts_known: 5
      tasks_involved: 2
      active_gaps: 4

  # 维度三：任务类型熟练度（V3 新增）
  task_type_proficiency:
    - task_type: "周报/月报制作"
      proficiency: 0.58
      examples_completed: 5
      user_satisfaction: 0.8
      recognized_pattern: "progress_report_creation"
    - task_type: "干系人沟通"
      proficiency: 0.35
      examples_completed: 3
      user_satisfaction: 0.6
    - task_type: "数据分析报告"
      proficiency: 0.25
      examples_completed: 2
      user_satisfaction: 0.5

  # 维度四：用户模型置信度（V3 新增）
  user_model_confidence:
    communication_style: 0.70
    decision_patterns: 0.40
    domain_context: 0.55
    overall: 0.52

  # 元认知（V3 新增）
  meta_cognition:
    total_known_unknowns: 12          # 已标记的知识缺口
    high_priority_gaps: 3
    curiosity_level: 2                # 0-3
    questions_asked_today: 1
    learning_velocity:
      tool_skills: 0.03/week
      domain_familiarity: 0.05/week
      task_proficiency: 0.04/week
      user_model: 0.02/week

  # 演化历史
  version_history:
    - version: 15
      timestamp: datetime
      changes: "新增领域「国企项目管理」; user_model_confidence +0.05"
    # ...
```

### 2.6 知识缺口（V3 新增）

```yaml
KnowledgeGap:
  gap_id: string
  domain: string                     # "膜力云智慧水务"
  topic: string                      # "数据源架构"
  specific_question: string          # "城乡数据平台的数据是API实时同步还是定时推送？"
  
  detected_at: datetime
  detected_in_context: string        # "执行周报任务时，数据采集阶段"
  detection_reason:
    type: "unknown_term" | "recurring_confusion" | "user_correction" | "structural_blank"
    detail: "在 5 个任务中均出现'数据源'相关操作，但知识库中未定义数据源之间的关系"
  
  priority: float                    # 0.0-1.0 (综合得分)
  priority_factors:
    relevance: 0.8                   # 与活跃项目高度相关
    frequency: 0.9                   # 频繁遇到
    impact: 0.7                      # 填补后预计提升效率
  
  status: "open" | "asked" | "answered" | "resolved" | "stale" | "dismissed"
  
  question_drafted: string           # 如果 status="open" 且 priority 达标
  asked_at: datetime | null
  asked_via: "telegram" | null
  answer_summary: string | null
  answer_confidence: float | null
  resolved_at: datetime | null
  
  attempts:                         # 尝试填充的历史
    - action: "auto_search"
      timestamp: datetime
      result: "未找到可靠来源"
    - action: "asked_user"
      timestamp: datetime
      result: "已回答"
  
  user_reaction: string | null      # "answered" | "ignored" | "dismissed" | "annoyed"
```

### 2.7 Curiosity 配置（V3 新增）

```yaml
CuriosityConfig:
  mode: "ask_when_confident"         # "passive" | "mark_gaps_only" | "ask_when_confident" | "fully_active"
  
  max_questions_per_day: 3
  quiet_hours: ["22:00", "08:00"]
  min_gap_priority_to_ask: 0.6
  
  batch_questions: true              # 多个问题合并为一条消息
  max_questions_per_batch: 3
  
  require_first_confirmation: true   # 首次主动提问前需用户确认
  cooldown_after_user_annoyed: "7d"  # 用户表达不满后冷却期
  
  auto_downgrade:
    ignored_after_days: 3            # 提问被忽略 3 天后降级
    stale_after_days: 7              # 7 天后标记为 stale
  
  level_requirements:                # 升级条件
    "0→1": {min_tool_proficiency: 0.3}
    "1→2": {manual_confirmation: true}
    "2→3": {min_overall_proficiency: 0.7, manual_confirmation: true}
```

### 2.8 AutonomyPolicy（V3 扩展：新增提问自主性）

```yaml
AutonomyPolicy:
  # V2 原有：工具自主性
  tool_autonomy:
    default_policy:
      unknown_operation: "confirm"
      low_risk_known: "inform"
      high_risk_known: "confirm"
      after_error: "downgrade_one"
    decision_mapping:
      proceed: "自主执行"
      inform: "执行并告知"
      confirm: "等待确认"
      block: "拒绝执行"

  # V3 新增：提问自主性
  question_autonomy:
    default_mode: "mark_gaps_only"   # 初始级别
    
    level_behaviors:
      "0_passive":
        description: "完全不主动，静默学习"
        gap_detection: false
        auto_question: false
        auto_research: false
      
      "1_mark_gaps":
        description: "检测并标记缺口，但不提问"
        gap_detection: true
        auto_question: false
        auto_research: false
        user_visible: "/praxis gaps"
      
      "2_ask_when_confident":
        description: "高优先级缺口择机提问"
        gap_detection: true
        auto_question: true          # 受 governance 约束
        auto_research: false
        question_constraints:
          max_per_day: 3
          min_priority: 0.6
          batch_merge: true
      
      "3_fully_active":
        description: "主动研究 + 择机提问"
        gap_detection: true
        auto_question: true
        auto_research: true          # 低风险缺口自研
        research_constraints:
          tools_allowed: ["browser", "web_search"]
          sandbox_allowed: true
          max_auto_actions_per_day: 10
```

---

## 三、Curiosity Engine 子系统设计

### 3.1 系统定位

Curiosity Engine 不是一个独立的 Layer——它是嵌入在 L3（KnowledgeManager）和 L4（LearningEngine）之间的横切关注点，受 L6（AutonomyEngine）的提问治理约束。

```
L6 AutonomyEngine
    ▲
    │ 治理：能不能提问？
    │
L4 LearningEngine
    │
    ├─ Curiosity Engine
    │   ├─ GapDetector       (调用 L3 知识图谱)
    │   ├─ GapPrioritizer    (调用 L5 能力模型)
    │   ├─ ActionGenerator   (生成学习行动)
    │   └─ QuestionGovernor  (调用 L6 治理规则 + 用户模型)
    │
    ▼
L3 KnowledgeManager
```

### 3.2 四个阶段详解

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Gap Detection（缺口检测）                            │
│                                                               │
│ Inputs:                                                       │
│  • TaskTrace.task_reflection（本任务的领域和概念）            │
│  • KnowledgeManager 知识图谱（已有知识）                      │
│  • CompetencyModel.domain_familiarity（已有领域覆盖度）       │
│  • 用户消息中出现的未知术语（来自 message_received）          │
│                                                               │
│ Algorithm:                                                    │
│  for each concept in task_context:                            │
│    if concept not in knowledge_graph:                         │
│      → new KnowledgeGap { topic: concept, priority: ? }      │
│    elif concept.familiarity < 0.3:                            │
│      → deepen existing KnowledgeGap                          │
│                                                               │
│  for each user_correction in session:                         │
│    if correction implies missing domain knowledge:            │
│      → KnowledgeGap { topic: extract_root_concept }          │
│                                                               │
│  for each dimension in competency_model:                      │
│    if dimension.growth_rate < 0.01/week for 4+ weeks:         │
│      → KnowledgeGap { topic: "结构性停滞: {dimension}" }     │
│                                                               │
│ Output: List<KnowledgeGap> (new + updated)                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Gap Prioritization（缺口优先级排序）                 │
│                                                               │
│ Scoring (0.0-1.0):                                            │
│                                                               │
│  relevance_score =                                             │
│    • 0.9 if gap.domain matches an active project              │
│    • 0.5 if gap.domain matches an inactive project            │
│    • 0.2 if gap.domain has no associated project              │
│                                                               │
│  frequency_score =                                             │
│    • min(1.0, gap.occurrences / 5)  // 5次以上→1.0          │
│                                                               │
│  impact_score =                                                │
│    • 0.8 if filling gap would directly improve task success   │
│    • 0.5 if filling gap would improve efficiency              │
│    • 0.2 if filling gap is "nice to have"                     │
│                                                               │
│  urgency_score =                                               │
│    • 0.9 if blocking current task                             │
│    • 0.5 if will block upcoming task                          │
│    • 0.1 if no known upcoming dependency                      │
│                                                               │
│  priority = (relevance × 0.35) + (frequency × 0.25)           │
│           + (impact × 0.25) + (urgency × 0.15)                │
│                                                               │
│ Output: List<KnowledgeGap> (sorted by priority desc)          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Action Generation（学习行动生成）                    │
│                                                               │
│ Decision Matrix:                                              │
│                                                               │
│  priority < 0.3:                                              │
│    action: "mark_silent"                                      │
│    → 标记为 open，不主动提醒                                  │
│    → 自然填充（如果后续任务中遇到答案，自动关联）             │
│                                                               │
│  priority 0.3-0.6:                                            │
│    action: "mark_visible"                                     │
│    → 标记为 open，用户可通过 /praxis gaps 看到               │
│    → curiosity.level >= 3 时尝试自主检索                      │
│                                                               │
│  priority 0.6-0.8:                                            │
│    action: "draft_question"                                   │
│    → 生成提问草稿                                             │
│    → 交由 Phase 4 (Governance) 决定何时发送                   │
│                                                               │
│  priority > 0.8:                                              │
│    action: "ask_now"                                          │
│    → 立即进入 Governance 检查                                 │
│    → 如果当前任务被阻塞 → 几乎一定通过（除非用户静默）        │
│                                                               │
│ Output: List<LearningAction>                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Phase 4: Question Governance（提问治理）                      │
│                                                               │
│ Checks (all must pass):                                       │
│                                                               │
│  ✓ frequency check:                                           │
│    questions_asked_today < curiosity.max_questions_per_day    │
│                                                               │
│  ✓ timing check:                                              │
│    current_time ∉ curiosity.quiet_hours                       │
│    time_since_last_user_message > 60s                         │
│    no active high-priority task in progress                   │
│                                                               │
│  ✓ redundancy check:                                          │
│    same question not asked in last 3 days                     │
│    same question not pending (status="asked" waiting reply)   │
│                                                               │
│  ✓ user_state check:                                          │
│    user_model.current_status.recent_urgency != "high"         │
│    user hasn't recently expressed annoyance                   │
│    (respect cooldown_after_user_annoyed)                      │
│                                                               │
│  ✓ batch merge (if applicable):                               │
│    if multiple questions pending → merge into one message     │
│    max questions_per_batch enforced                           │
│                                                               │
│  ✓ format compliance:                                         │
│    question includes: context + why asking + what tried       │
│    tone: respectful, not demanding                            │
│                                                               │
│ If all checks pass → send via OpenClaw message_sending        │
│ If any check fails → defer to next evaluation point           │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、核心流程

### 4.1 完整任务执行流程（V3：含主动学习）

```
User (via Telegram): "帮我做膜力云的周报"
          │
          ▼
┌─────────────────────────────────────────────┐
│ [Hook: message_received]  ← V3 新增         │
│ Praxis:                                     │
│ • 意图分类: "任务分配"                        │
│ • 检测术语: "膜力云", "周报"                 │
│ • "膜力云" → domain_familiarity 中有        │
│ • "周报" → 匹配 TaskPattern                 │
│   → 找到: "progress_report_creation"        │
│   → 加载: typical_tool_chain + user_prefs   │
│   → 注入任务上下文                           │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ [Hook: before_tool_call × N]                 │
│ Praxis:                                     │
│ • 每次工具调用前:                              │
│   ├─ 查询 tool_skills[tool_id].proficiency   │
│   ├─ 查询 domain_familiarity 中的约束        │
│   ├─ 查询 user_model 中的偏好                │
│   ├─ 检索 TaskPattern.best_practices         │
│   └─ 返回 autonomy_decision + context        │
│                                              │
│ • tool=data_fetcher: proficiency 0.5          │
│   → 注入: "数据源包括城乡数据平台(实时API)"    │
│ • tool=ppt_generator: proficiency 0.55        │
│   → 注入: "公司季度模板; 风险分析放第2页"      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ [Hook: after_tool_call × N]                  │
│ Praxis:                                     │
│ • data_fetcher: success                      │
│   → 但发现采样了 3 个数据源，其中 1 个超时   │
│   → 暂存 procedural_optimization 事件        │
│ • ppt_generator: success                     │
│   → 无学习事件                               │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ [Hook: agent_end]  ← V3 扩展                 │
│ Praxis:                                     │
│                                              │
│ [工具级处理]                                  │
│ • data_fetcher 超时 → known_failure_mode     │
│ • ppt_generator: 成功, proficiency 微增      │
│                                              │
│ [任务级反思]  ← V3 新增                      │
│ • goal_achieved: true                        │
│ • 工具链 [data_fetch,chart,ppt]              │
│   → 匹配 TaskPattern "progress_report"      │
│   → occurrence_count: 5→6                   │
│ • 涉及领域: "膜力云智慧水务"                  │
│   → domain_familiarity: 0.45 → 0.47         │
│                                              │
│ [Curiosity Engine]  ← V3 新增                │
│ • 检测到术语 "智慧水务接入" 多次出现          │
│   → 知识图谱中无定义                          │
│   → 新建 KnowledgeGap:                       │
│     {topic: "智慧水务接入方案", priority: 0.65}│
│ • 检测到 domain_familiarity 增长缓慢          │
│   → 标记: 建议用户教导该领域核心概念          │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ OpenClaw 回复用户: "周报做好了！..."         │
│ 用户回复: "不错，分析有深度"                  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ [Hook: message_received]  ← V3 新增         │
│ Praxis:                                     │
│ • 意图分类: "任务评价" (positive)             │
│ • 关联到刚刚的 agent_end 任务                │
│ • 更新 task_type_proficiency["周报"] +0.03   │
│ • 更新 user_model (当前满意度: high)          │
└─────────────────────────────────────────────┘
```

### 4.2 主动提问流程

```
┌──────────────────────────────────────────────────────────┐
│            主动提问流程 (Proactive Question Flow)           │
│                                                              │
│ 前提条件: CuriosityConfig.mode >= "ask_when_confident"      │
│                                                              │
│ agent_end 触发 Curiosity Engine:                            │
│   Phase 1 (Gap Detection) → 发现 3 个缺口                  │
│   Phase 2 (Prioritization) → 排序后:                       │
│     Gap A: priority 0.75 (高关联+高频率+影响任务质量)      │
│     Gap B: priority 0.50 (中关联)                          │
│     Gap C: priority 0.25 (低关联)                          │
│   Phase 3 (Action Generation) →                            │
│     Gap A → action: "draft_question"                       │
│     Gap B → action: "mark_visible"                         │
│     Gap C → action: "mark_silent"                          │
│                                                              │
│ Phase 4 (Governance) 检查:                                  │
│   ✓ 今天已问: 1/3                                          │
│   ✓ 当前时间: 15:30 (不在 quiet_hours)                     │
│   ✓ 用户 5 分钟前刚发过消息 (对话活跃中)                    │
│   ✗ 但当前有高优先级任务! → defer                          │
│                                                              │
│ ── 30 分钟后，agent_end 再次触发 ──                         │
│                                                              │
│ Phase 4 重新检查:                                            │
│   ✓ 今天已问: 1/3                                          │
│   ✓ 当前时间: 16:00                                         │
│   ✓ 无活跃高优先级任务                                      │
│   ✓ 用户处于正常状态（非紧急期）                             │
│   → ALL CHECKS PASSED                                       │
│                                                              │
│ 通过 OpenClaw message_sending 发送:                          │
│ ┌─────────────────────────────────────────┐                │
│ │ 📚 我有个问题（今天第 2/3 个）           │                │
│ │                                          │                │
│ │ 在连续几周的膜力云周报制作中，我注意到     │                │
│ │ 每次都会遇到「智慧水务接入」这个概念。    │                │
│ │                                          │                │
│ │ 我的理解是它涉及污水厂的数据接入，         │                │
│ │ 但我不太确定：                            │                │
│ │ → 它和城乡数据平台对接是同一个项目吗？     │                │
│ │ → 还是独立的一条线？                      │                │
│ │                                          │                │
│ │ 我查了之前的会议记录但没找到明确说明。     │                │
│ │ 方便的时候指点一下就好 🙏                 │                │
│ └─────────────────────────────────────────┘                │
│                                                              │
│ KnowledgeGap 更新:                                           │
│   status: "open" → "asked"                                  │
│   asked_at: now                                             │
│   question_drafted: (the message sent)                      │
│                                                              │
│ 用户回复后:                                                   │
│   message_received → 意图: "教导模式"                        │
│   → 提取知识 → 填充 DomainKnowledge                          │
│   → KnowledgeGap: status → "answered"                       │
│   → 下次任务直接应用 ✅                                      │
└──────────────────────────────────────────────────────────┘
```

### 4.3 用户拒绝/忽略处理

```
用户忽略提问 (3 天无回复):
  → Gap.priority -= 0.2 (降低，但不删除)
  → Gap.status → "stale" after 7 days
  → 不再在同话题上提问

用户回复 "以后别问了":
  → 该特定 Gap: status → "dismissed", priority → 0
  → 不降级整体 curiosity level

用户回复 "都别问了" 或 "别烦我":
  → CuriosityConfig.mode → "mark_gaps_only" (降级到 Level 1)
  → cooldown: 7 天后可重新询问用户是否恢复
  → 记录在 user_model: "用户对主动提问敏感"

用户回复 "好的，让我解释..." (正面回应):
  → 提取知识，填充缺口
  → 该 Gap 关闭
  → 对类似话题的提问信心 +0.1 (更敢问)
```

---

## 五、Hook 注册（V3 更新）

```typescript
function registerHooks(): PluginHookRegistration[] {
  return [
    {
      hook: "session_start",
      handler: onSessionStart,
      priority: "high",
    },
    {
      hook: "message_received",     // ← V3 新增
      handler: onMessageReceived,
      priority: "high",              // 需要在 agent 处理之前分析意图
    },
    {
      hook: "before_tool_call",
      handler: onBeforeToolCall,
      priority: "normal",
    },
    {
      hook: "after_tool_call",
      handler: onAfterToolCall,
      priority: "normal",
    },
    {
      hook: "agent_end",
      handler: onAgentEnd,           // ← V3 扩展（任务反思 + Curiosity Engine）
      priority: "normal",
    },
    {
      hook: "session_end",
      handler: onSessionEnd,         // ← V3 扩展（缺口审计）
      priority: "low",
    },
  ];
}
```

---

## 六、AgentMemory 集成映射（V3 更新）

### 6.1 Slot 存储（高频读写，当前状态）

| Praxis 数据 | AgentMemory 调用 | V2 | V3 |
|-------------|-----------------|----|----|
| CompetencyModel (四维) | `memory_slot_get/set "competency_model"` | ✅ | ✅（扩展） |
| Tool Registry | `memory_slot_get/set "tool_registry"` | ✅ | ✅ |
| AutonomyPolicy (含提问策略) | `memory_slot_get/set "autonomy_policy"` | ✅ | ✅（扩展） |
| UserModel | `memory_slot_get/set "user_model"` | ❌ | ✅ 新增 |
| CuriosityConfig | `memory_slot_get/set "curiosity_config"` | ❌ | ✅ 新增 |

### 6.2 Memory 存储（类型化知识，按需检索）

| Praxis 数据 | AgentMemory type | 频率 | V2 | V3 |
|-------------|-----------------|------|----|----|
| 领域知识 | `memory_save(type="domain_knowledge")` | 教导/学习时 | ❌ | ✅ |
| 任务模式 | `memory_save(type="task_pattern")` | agent_end (新模式) | ❌ | ✅ |
| 用户模型快照 | `memory_save(type="user_model_snapshot")` | 重大更新时 | ❌ | ✅ |
| 流程知识 | `memory_save(type="procedural_knowledge")` | 优化发现时 | ❌ | ✅ |
| 工具知识 | `memory_save(type="tool_knowledge")` | 新发现时 | ✅ | ✅ |
| 知识缺口 | `memory_save(type="knowledge_gap")` | agent_end + session_end | ❌ | ✅ |

### 6.3 Lesson 存储（学习事件）

| 学习事件类型 | AgentMemory 调用 | V2 | V3 |
|------------|-----------------|----|----|
| mistake_correction | `memory_lesson_save` | ✅ | ✅ |
| domain_insight | `memory_lesson_save` | ❌ | ✅ |
| preference_discovery | `memory_lesson_save` | ❌ | ✅ |
| task_pattern_recognition | `memory_lesson_save` | ❌ | ✅ |
| procedural_optimization | `memory_lesson_save` | ❌ | ✅ |

### 6.4 检索（按需 + 预加载）

| 操作 | AgentMemory 调用 | 频率 |
|------|-----------------|------|
| 多类型知识检索 | `memory_smart_search(query, types=[...])` | before_tool_call |
| 任务模式匹配 | `memory_smart_search(query, type="task_pattern")` | message_received |
| 跨图谱反思 | `memory_reflect` | session_end |
| 行为模式检测 | `memory_patterns(types=["behavioral", "task"])` | session_end |
| 任务经验压缩 | `memory_crystallize` | agent_end |

---

## 七、会话内缓存策略

与 V2 相同的策略（session_start 批量加载 → 全内存操作 → agent_end 批量写 → session_end 最终 flush），V3 扩展加载范围：

```
session_start 加载:
  competencyModel     ← memory_slot_get("competency_model")
  autonomyPolicy      ← memory_slot_get("autonomy_policy")
  toolRegistry        ← memory_slot_get("tool_registry")
  userModel           ← memory_slot_get("user_model")           ← V3 新增
  curiosityConfig     ← memory_slot_get("curiosity_config")      ← V3 新增
  activeGaps          ← memory_smart_search(type="knowledge_gap", status="open") ← V3 新增
  relevantDomains     ← memory_smart_search(type="domain_knowledge", limit=10)    ← V3 新增
  mentalState         ← memory_smart_search("mental_state", 3)

session 期间:
  所有查询命中 in-memory cache
  knowledge search 例外: 按需调用 MCP（支持多 type 过滤）
  pending_learning_events: 存储在 plugin 内存（5 种类型）
  new_gaps: 存储在 plugin 内存 → agent_end 时写入

agent_end:
  批量写入 learning events (5 types) → AgentMemory
  批量写入/更新 knowledge_gaps → AgentMemory
  更新 competency_model (四维) → AgentMemory
  更新 user_model → AgentMemory
  更新 in-memory cache

session_end:
  最终 flush + 跨图谱反思
  Curiosity Engine 最终扫描
  mental_state 保存
  能力模型版本快照
```

---

## 八、V3 范围边界

### V3 包含

| 组件 | 优先级 | 说明 |
|------|--------|------|
| 四维能力模型 | P0 | tool_skills + domain_familiarity + task_type_proficiency + user_model_confidence |
| 五维知识分类 | P0 | domain / task_pattern / user_model / procedural / tool |
| 五种学习事件 | P0 | mistake_correction + domain_insight + preference_discovery + task_pattern + procedural_optimization |
| message_received Hook | P0 | 语义意图分析 + 非工具学习信号捕获 |
| Curiosity Engine | P0 | 缺口检测 + 排序 + 行动生成 + 提问治理 |
| 主动提问机制 | P1 | Level 0-3 + 频率/时机/批量治理 |
| KnowledgeGap 追踪 | P1 | 生命周期管理 + 优先级排序 |
| 任务模式识别 | P1 | agent_end 任务级反思 + 模式提取 |
| 用户模型动态更新 | P1 | message_received + agent_end + session_end |
| `/praxis gaps/curiosity/domains/patterns` | P1 | 新增用户命令 |
| 定期缺口审计 cron | P2 | 每周跨会话缺口重排序 |

### V3 明确排除（与 V2 相同 + 新增）

| 组件 | 说明 | 目标版本 |
|------|------|---------|
| 自建 agent runtime / 消息通道 / 工具执行 | 已由 OpenClaw 提供 | 不需要 |
| 音频/视频实时转写 | 需要外部基础设施 | V4 |
| 跨工具复杂工作流引擎 | V3 聚焦任务模式识别，不是执行引擎 | V4 |
| 多实例 mesh sync | 依赖 AgentMemory mesh 成熟度 | V4 |
| GUI 能力模型查看器 | V3 使用命令行 + 雷达图文本展示 | V4 |
| 自主代码修改 | Curiosity Level 3 的自主研究 | V4 |
| 情感感知（用户情绪检测） | 需要多模态输入 | V5+ |

### V1 → V2 → V3 完整差异

| 维度 | V1 (独立 Harness) | V2 (Plugin) | V3 (主动学习者) |
|------|-------------------|-------------|----------------|
| 运行环境 | Claude Code Harness | OpenClaw Memory Plugin | 同 V2 |
| 存储 | AgentMemory MCP | 同 V1 | 同 V1 |
| 工具执行 | Praxis 自建 | OpenClaw 原生 | 同 V2 |
| 能力模型 | 1 维（工具） | 1 维（工具） | **4 维** |
| 知识分类 | 无 | 无 | **5 类** |
| 学习事件 | 1 种 | 1 种 | **5 种** |
| Hook 数量 | 自建 | 5 个 | **6 个** |
| 学习触发 | 被动 | 被动 | **被动 + 主动** |
| 用户交互 | 单向 | 单向 | **双向** |
| 核心创新 | 学习闭环概念 | 正确的载体 | **完整的学习者模型** |

---

## 九、兄弟文件

- [What is Praxis V3?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？
- [Why Praxis V3?](why.md) — 为什么需要 V3
- [How does it work?](how.md) — 六层架构 + Curiosity Engine 详解
- [When does it operate?](when.md) — 完整生命周期
- [Where does it sit?](where.md) — 架构定位
