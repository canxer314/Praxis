# Praxis V1 Architecture Design

> 版本：v1 (MVP)
> 状态：设计阶段
> 最后更新：2026-06-10

---

## 一、架构总览

### 六层架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Praxis V1 Architecture                        │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Harness Layer (Claude Code)                  │  │
│  │                                                                  │  │
│  │  Hooks:                                                          │  │
│  │  • SessionStart → load_competency_model() + inject_guidance()   │  │
│  │  • PostToolUse → maybe_trigger_learning_event()                 │  │
│  │  • SessionEnd   → reflect_and_update() + save_mental_state()    │  │
│  │                                                                  │  │
│  │  Skills/Commands:                                                │  │
│  │  • /praxis status     → 查看能力模型                           │  │
│  │  • /praxis teach      → 主动教导知识                           │  │
│  │  • /praxis task       → 分配任务                               │  │
│  │  • /praxis review     → 审核演化提案                           │  │
│  │  • /praxis learn      → 发起学习任务                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                    │                                 │
│  ┌─────────────────────────────────┼─────────────────────────────┐  │
│  │                    Praxis Core  │                              │  │
│  │                                  │                              │  │
│  │  L6 ┌──────────────────────────┐│                              │  │
│  │     │  自主决策引擎             ││  proficiency × risk → action │  │
│  │     │  AutonomyEngine          ││                              │  │
│  │     └────────────┬─────────────┘│                              │  │
│  │                  │              │                              │  │
│  │  L5 ┌────────────┴─────────────┐│                              │  │
│  │     │  能力模型管理器           ││  技能树 + 证据 + 成长轨迹    │  │
│  │     │  CompetencyManager       ││                              │  │
│  │     └────────────┬─────────────┘│                              │  │
│  │                  │              │                              │  │
│  │  L4 ┌────────────┴─────────────┐│                              │  │
│  │     │  学习闭环引擎             ││  执行→评估→差距→更新→固化   │  │
│  │     │  LearningEngine          ││                              │  │
│  │     └────────────┬─────────────┘│                              │  │
│  │                  │              │                              │  │
│  │  L3 ┌────────────┴─────────────┐│                              │  │
│  │     │  知识管理器               ││  多模态摄入 + 索引 + 关联   │  │
│  │     │  KnowledgeManager        ││                              │  │
│  │     └────────────┬─────────────┘│                              │  │
│  │                  │              │                              │  │
│  │  L2 ┌────────────┴─────────────┐│                              │  │
│  │     │  任务编排器               ││  任务分解 + 工作流 + 容错   │  │
│  │     │  TaskOrchestrator        ││                              │  │
│  │     └────────────┬─────────────┘│                              │  │
│  │                  │              │                              │  │
│  │  L1 ┌────────────┴─────────────┐│                              │  │
│  │     │  工具注册与熟练度管理器    ││  工具发现 + 反馈解释器      │  │
│  │     │  ToolRegistry            ││                              │  │
│  │     └──────────────────────────┘│                              │  │
│  └─────────────────────────────────┼──────────────────────────────┘  │
│                                    │                                 │
│  ┌─────────────────────────────────┼─────────────────────────────┐  │
│  │               AgentMemory (Storage Backend)                    │  │
│  │                                                                  │  │
│  │  • memory_slot_*        → 能力模型、工具注册表 (当前状态)      │  │
│  │  • memory_save          → 知识条目、演化历史、学习事件         │  │
│  │  • memory_smart_search  → 知识检索、经验召回                   │  │
│  │  • memory_lesson_*      → 教训存储和检索                       │  │
│  │  • memory_crystallize   → 任务完成→经验压缩                    │  │
│  │  • memory_patterns      → 行为模式检测                         │  │
│  │  • memory_reflect       → 跨图谱反思                           │  │
│  │  • memory_sessions      → 会话管理                             │  │
│  │  • memory_verify        → 溯源验证                             │  │
│  │  • memory_mesh_sync     → 多实例同步                           │  │
│  │  • memory_governance_*  → 数据生命周期                         │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                    │                                 │
│  ┌─────────────────────────────────┼─────────────────────────────┐  │
│  │                    External World                               │  │
│  │                                                                  │  │
│  │  MCP Servers  │  REST APIs  │  MQTT/IoT  │  WebSocket  │  ...  │  │
│  │  (代码工具)    │  (PPT/邮件)  │  (咖啡机)   │  (会议音频)  │      │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## 二、核心数据模型

### 2.1 Tool（工具注册）

```yaml
Tool:
  id: string                    # 唯一标识 "coffee_machine"
  name: string                  # 人类可读名称 "咖啡机"
  type: ToolType                # physical_control | document_creation | communication | perception | data_processing
  provider: string              # MCP | REST | MQTT | gRPC | WebSocket
  status: ToolStatus            # active | disabled | error | onboarding
  
  interface:
    actions:
      - name: string
        params: [{name, type, required, default}]
        returns: string
    events:                     # 异步事件
      - name: string
        payload_schema: object
  
  feedback:
    success_signals: string[]   # ["brew_complete", "user_affirms"]
    failure_signals: string[]   # ["error", "out_of_beans"]
    quality_indicators:         # 反馈信号 → 学习方向
      - signal: string
        interpretation: string
  
  risk:
    physical_consequences: string[]
    max_autonomy: AutonomyLevel # supervised | semi_autonomous | fully_autonomous
    confirm_required_for: string[]  # ["first_use_of_day", "parameter_change"]
    special_concerns: string[]      # ["privacy", "safety_critical"]
  
  metadata:
    installed_at: datetime
    version: string
    documentation_url: string
```

### 2.2 Task（任务）

```yaml
Task:
  id: string
  title: string
  type: TaskType               # implementation | analysis | learning | operation | perception
  
  assignment:
    description: string
    context: {project, relates_to, dependencies}
    expectations:
      output: string[]
      quality_criteria: string[]
      constraints: string[]
    autonomy_granted: AutonomyLevel  # 用户指定的自主级别（可覆盖默认）
  
  execution:
    sessions: string[]          # 涉及的会话 ID
    tools_used: string[]        # 使用的工具
    decisions: [{what, why, alternatives_considered}]
    mistakes: [{what, when, how_fixed}]
    self_assessment: string
  
  outcome:
    status: TaskStatus          # pending | in_progress | completed | blocked | needs_review
    quality_score: float        # 0.0-1.0
    user_feedback:
      rating: float
      notes: string
      implicit_signals: string[]  # 从对话中自动提取的反馈信号
    lessons_extracted: string[] # 关联的 Lesson ID
```

### 2.3 Knowledge（知识条目）

```yaml
Knowledge:
  id: string
  title: string
  
  source:
    type: KnowledgeSource       # user_instruction | document | voice_note | image | video | web_article | self_derived
    modality: Modality          # text | audio_transcript | image_description | video_transcript
    original_ref: string        # 来源会话/文件引用
    media_location: string?     # 原始媒体文件路径（如有）
  
  content: string               # 知识的主体内容
  
  organization:
    domain: string              # "authentication"
    topics: string[]            # ["jwt", "token-management"]
    skill_associations: string[] # ["skill:web-api-design"]
    tool: string?               # 关联的工具 ID
    difficulty_level: string    # beginner | intermediate | advanced
  
  state:
    confidence: float           # 0.0-1.0 对此知识的确定程度
    last_applied: datetime
    application_count: int
    needs_review: boolean
```

### 2.4 LearningEvent（学习事件）

```yaml
LearningEvent:
  id: string
  timestamp: datetime
  source_task: string           # 关联的 Task ID
  
  type: LearningEventType       # mistake_correction | skill_improvement | new_knowledge | feedback_integration | insight
  
  description:
    before: string              # 之前的行为/认知
    after: string               # 之后的行为/认知
    root_cause: string          # 根因分析
  
  impact:
    affected_skills:
      - skill: string
        proficiency_change: float  # +0.1
        reason: string
    new_knowledge_ids: string[] # 由此产生的新知识条目
    prevention_strategy: string # 如何防止再犯（如适用）
  
  evidence:
    observation_refs: string[]  # AgentMemory observation IDs
    confidence: float           # 对这个学习事件的置信度
```

### 2.5 CompetencyModel（能力模型）

```yaml
CompetencyModel:
  version: int
  last_updated: datetime
  total_tasks_completed: int
  
  skill_tree:
    - domain: string            # "software-engineering"
      overall_proficiency: float
      skills:
        - id: string            # "skill:system-architecture"
          name: string
          tool: string?         # 关联工具 ID（如适用）
          proficiency: float    # 0.0-1.0
          level: SkillLevel     # novice | advanced_beginner | competent | proficient | expert
          
          evidence:             # 证据驱动的评估
            - task: string
              performance: float
              date: datetime
          
          best_practices: string[]
          anti_patterns:
            - pattern: string
              occurrences: int
              last_occurred: datetime
              prevention: string
          
          learning_focus: string   # 当前学习重点
          knowledge_gaps: string[] # 已知知识缺口
          
          user_preferences: object # 用户对该技能维度的偏好
          
          autonomy:
            level: AutonomyLevel
            needs_confirmation_when: string[]
            effective_since: datetime
          
          learning_timeline:       # 成长时间线
            - date: datetime
              event: string
              proficiency_before: float
              proficiency_after: float
  
  # 跨工具组合技能
  composite_skills:
    - id: string
      name: string               # "周报工作流"
      tool_sequence: string[]    # 工具调用序列
      overall_proficiency: float
      bottleneck: string         # 限制整体表现的最弱工具
  
  # 工作风格（从行为模式中提取）
  working_style:
    problem_solving: string      # "从第一性原理出发，然后匹配已知模式"
    code_style: string           # "显式优于取巧，错误处理优先"
    communication: string        # "结构化，基于证据，提供替代方案"
    learning_style: string       # "在有反馈的真实任务中学得最好"
```

### 2.6 AutonomyPolicy（自主性策略）

```yaml
AutonomyPolicy:
  # 全局默认策略
  default_policy:
    unknown_operation: "confirm"     # 未知操作 → 确认
    low_risk_known: "inform"        # 低风险已知 → 告知后执行
    high_risk_known: "confirm"      # 高风险已知 → 确认后执行
    after_error: "downgrade_one"     # 出错后 → 降级自主性一级
  
  # 每个操作的策略
  operation_policies:
    - operation: string             # 操作名（如 "coffee_machine.brew"）
      required_proficiency: float   # 该自主级别所需的最低熟练度
      autonomy: AutonomyLevel
      exceptions: string[]          # 例外情况
  
  # 风险分级
  risk_levels:
    low: ["reading_files", "searching", "summarizing"]
    medium: ["code_refactoring", "document_generation"]
    high: ["database_changes", "email_sending", "physical_device_control"]
    critical: ["production_deploy", "financial_operations", "privacy_sensitive"]
```

## 三、核心流程

### 3.1 任务执行流程

```
User: "帮我做一份本周的进度报告 PPT"
          │
          ▼
┌─────────────────────────────────────────────┐
│ TaskOrchestrator.create_task()               │
│ • 解析任务：type=document_creation           │
│ • 查询工具注册表：需要 ppt_generator          │
│ • 查询能力模型：ppt_generator proficiency=0.55│
│ • 决定自主性：semi_autonomous (需确认关键决策)│
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ LearningEngine.pre_task_injection()          │
│ • 查询知识库："PPT设计原则"、"上周报告格式"   │
│ • 查询 known_failure_modes：上次字体太小      │
│ • 注入上下文：偏好简洁 + 图表优先             │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ LLM + Tools 执行任务                         │
│ • 创建 PPT → 添加幻灯片 → 插入图表           │
│ • 自主操作：添加幻灯片                       │
│ • 确认操作：最终设计方案                     │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ TaskOrchestrator.complete_task()             │
│ • AI 自我评估                                │
│ • 收集用户反馈                               │
│ • 触发 LearningEngine.process_feedback()     │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ LearningEngine.generate_learning_event()     │
│ • 比较表现 vs 能力模型的预期                 │
│ • 提取教训：图表位置选择需要更多上下文信息    │
│ • 更新技能评分：ppt-proficiency +0.05        │
│ • 存储 LearningEvent + Lesson                │
└─────────────────────────────────────────────┘
```

### 3.2 学习闭环流程

```
┌──────────────────────────────────────────────────────────┐
│                     Learning Loop                         │
│                                                           │
│  ┌──────────┐     ┌──────────┐     ┌──────────────┐     │
│  │ 执行任务  │────▶│ 评估结果  │────▶│ 识别能力差距  │     │
│  │ (Layer 2)│     │          │     │              │     │
│  └──────────┘     └────┬─────┘     └──────┬───────┘     │
│       ▲                │                  │              │
│       │           ┌────▼─────┐    ┌───────▼──────┐      │
│       │           │ 用户反馈  │    │ 更新能力模型  │      │
│       │           │ (稀缺资源)│    │ (Layer 5)    │      │
│       │           └──────────┘    └───────┬──────┘      │
│       │                                   │              │
│       │           ┌──────────┐    ┌───────▼──────┐      │
│       └───────────┤ 应用到   │◀───┤ 更新行为指引  │      │
│                   │ 下次任务  │    │ (注入上下文)  │      │
│                   └──────────┘    └──────────────┘      │
└──────────────────────────────────────────────────────────┘
```

### 3.3 自主性决策流程

```
AI 准备调用 tool.action
          │
          ▼
┌─────────────────────┐
│ 查询该操作的 policy  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     YES     ┌─────────────┐
│ proficiency >=       │───────────▶│ 自主执行     │
│ required_proficiency?│            │ 可告知用户   │
└──────────┬──────────┘            └─────────────┘
           │ NO
           ▼
┌─────────────────────┐     YES     ┌─────────────┐
│ 该操作是否低风险？    │───────────▶│ 确认后执行   │
└──────────┬──────────┘            └─────────────┘
           │ NO
           ▼
┌─────────────────────────────┐
│ 必须用户确认                  │
│ 提供：操作描述 + 风险评估     │
│ + 替代方案（如有）            │
└─────────────────────────────┘
```

## 四、AgentMemory 集成映射

### 存储映射表

| Praxis 数据 | AgentMemory 工具 | 存储方式 | 备注 |
|-------------|-----------------|---------|------|
| Tool Registry (active) | `memory_slot_get/set "tool_registry"` | Slot (project scope) | 当前工具注册表的序列化 JSON |
| Tool Registry (history) | `memory_save type="tool_registry_version"` | Memory + supersedes | 版本历史 |
| CompetencyModel (active) | `memory_slot_get/set "competency_model"` | Slot (project scope) | 当前能力模型 |
| CompetencyModel (history) | `memory_save type="competency_model_version"` | Memory + supersedes | 版本历史 |
| AutonomyPolicy | `memory_slot_get/set "autonomy_policy"` | Slot (project scope) | 当前策略 |
| Knowledge entries | `memory_save type="knowledge"` | Memory (typed) | 每一条知识 |
| Knowledge retrieval | `memory_smart_search` | Triple-stream search | type 过滤 + concepts 过滤 |
| Tasks | Actions + Sketches (AgentMemory Action system) | Action | 任务状态和依赖 |
| Task history | `memory_crystallize` → Crystal → Lessons | Crystal + Lesson | 任务完成后压缩 |
| Learning events | `memory_lesson_save` | Lesson | 学习事件作为教训 |
| Learning retrieval | `memory_lesson_recall` / `memory_smart_search` | Lesson search | 检索相关教训 |
| Behavior patterns | `memory_patterns` (扩展 behavioral 类型) | Pattern | 行为模式检测 |
| Session state | `memory_sessions` + `memory_checkpoint` | Session + Checkpoint | 会话管理 |
| Mental state | `memory_save type="mental_state"` | Memory | 跨会话连续性 |
| Reflections | `memory_reflect` → insights | Insight | 高阶反思 |
| Multi-modal (image) | `memory_save` + imageRef + `memory_vision_search` | Memory (image) | 图片知识 |
| Multi-modal (audio/video) | ❌ 需新建或使用外部转写 | TBD | V1 范围外 |
| Audit trail | `memory_audit` | Audit | 自动记录 |
| Data lifecycle | `memory_governance_*` + retention | Governance | 数据治理 |

### Harness ↔ AgentMemory 通信

```
Praxis Core ──(MCP calls)──▶ AgentMemory MCP Server
                                    │
                                    ├─ memory_slot_get("competency_model")
                                    ├─ memory_smart_search(query, type="knowledge")
                                    ├─ memory_lesson_save(...)
                                    ├─ memory_save(type="mental_state", ...)
                                    └─ ...
```

所有调用通过 MCP。会话开始时批量加载高频数据（能力模型、自主策略），会话期间按需检索。

## 五、Harness 集成点

### 5.1 Hooks

```yaml
# .claude/settings.json hooks 配置

hooks:
  SessionStart:
    - praxis_load_context:
        description: "加载 Praxis 能力模型和行为指引"
        actions:
          - memory_slot_get("competency_model")
          - memory_slot_get("autonomy_policy")
          - memory_slot_get("tool_registry")
          - memory_smart_search("mental_state", limit=3)
          - inject_into_system_prompt()
  
  PostToolUse:
    - praxis_track_tool_use:
        description: "追踪工具使用，检测学习事件"
        triggers: ["error", "user_correction", "task_completion"]
        actions:
          - evaluate_tool_performance()
          - maybe_generate_learning_event()
  
  SessionEnd:
    - praxis_reflect:
        description: "会话结束反思和能力更新"
        actions:
          - summarize_session_growth()
          - detect_new_patterns() via memory_patterns()
          - generate_evolution_proposals()
          - memory_save(type="mental_state", ...)
          - memory_slot_replace("competency_model", updated)
```

### 5.2 System Prompt 注入

每次会话开始时，Praxis 注入以下结构化的上下文块：

```markdown
## Praxis Context

### 当前能力概况
- 总体熟练度：0.70（competent）
- 最强领域：code-quality (0.85), technical-writing (0.80)
- 最弱领域：security-patterns (0.55), requirement-clarification (0.55)
- 当前学习重点：security-patterns

### 工具自主性策略
- coffee_machine: semi_autonomous（改参数需确认）
- ppt_generator: semi_autonomous（设计方案需确认）
- code_editor: fully_autonomous（低风险操作）
- email_sender: supervised（发邮件前必须确认）

### 上次停下的地方
[从 mental_state 加载]
```

### 5.3 User Commands

| 命令 | 功能 | 实现 |
|------|------|------|
| `/praxis status` | 查看能力模型和成长轨迹 | 读取 competency_model slot，格式化展示 |
| `/praxis tools` | 查看已注册工具及其熟练度 | 读取 tool_registry slot |
| `/praxis teach <topic>` | 主动教导知识 | 触发 KnowledgeManager.ingest() |
| `/praxis task <desc>` | 分配任务 | 触发 TaskOrchestrator.create_task() |
| `/praxis review` | 审核待处理的演化提案 | 列出未审批的更新提案 |
| `/praxis learn <topic>` | 创建学习任务 | AI 生成学习任务计划 |
| `/praxis history` | 查看学习历史时间线 | 检索 LearningEvent + Lesson |

## 六、多模态支持设计

### V1 支持范围

| 模态 | V1 支持 | 方式 |
|------|---------|------|
| 文字 | ✅ 完整支持 | 直接存储和索引 |
| 图片 | ✅ 基础支持 | 利用 AgentMemory 的 imageRef + vision_search |
| 语音 | ⚠️ 部分支持 | 外部转写 → 文本存储；原始音频文件引用 |
| 视频 | ⚠️ 部分支持 | 外部关键帧提取 + 转写 → 文本存储；原始视频引用 |
| 实时流 | ❌ V1 范围外 | 需要实时转写和事件流处理 |

### 统一知识入口

所有模态的知识通过统一的 Knowledge 数据模型存储：

```
┌─────────────────┐
│ 多模态输入       │
│ 文字/图片/音频   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 模态处理器       │
│ • 文字: 直接     │
│ • 图片: 视觉描述  │
│ • 音频: 转写     │
│ • 视频: 关键帧+转写│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Knowledge 条目   │
│ • source.modality│
│ • content (文本) │
│ • media_location │  ← 保留原始媒体引用
│ • skill_assoc    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AgentMemory      │
│ memory_save()    │
│ + 向量索引       │
└─────────────────┘
```

## 七、V1 范围边界

### V1: 包含

| 组件 | 优先级 | 说明 |
|------|--------|------|
| Tool Registry + Proficiency | P0 | 核心：工具注册和熟练度追踪 |
| CompetencyModel (slot-based) | P0 | 核心：能力模型的读写 |
| Task → Lesson extraction | P0 | 核心：任务完成后自动提取教训 |
| Knowledge ingestion (text + image) | P1 | 基础多模态知识管理 |
| SessionStart context injection | P1 | 会话开始时的上下文加载 |
| Post-task learning event generation | P1 | 任务完成后的自动学习 |
| `/praxis status` command | P1 | 用户可见的能力查看 |
| Autonomy decision (basic) | P2 | 基于熟练度的自主性建议 |
| SessionEnd reflection | P2 | 会话结束时的反思和状态保存 |
| Mental state continuity | P2 | 跨会话"思维状态"传递 |

### V1: 明确排除

| 组件 | 说明 | 目标版本 |
|------|------|---------|
| 音频/视频实时转写 | 需要外部基础设施 | V2 |
| 实时事件流处理 | 需要事件监听基础设施 | V2 |
| 跨工具复杂工作流引擎 | V1 聚焦单工具任务 | V3 |
| 多实例 mesh sync | 依赖 AgentMemory mesh 成熟度 | V3 |
| 演化叙事自动生成 | 需要足够的数据积累 | V3 |
| 自我驱动学习请求 | 需要成熟的缺口检测 | V3 |
| GUI 能力模型查看器 | V1 使用命令行 | V4 |

## 八、核心接口定义

### Praxis Core API (TypeScript-like)

```typescript
interface Praxis {
  // === Layer 1: Tool Registry ===
  toolRegistry: {
    register(tool: Tool): Promise<void>
    unregister(toolId: string): Promise<void>
    get(toolId: string): Promise<Tool>
    list(): Promise<Tool[]>
    updateProficiency(toolId: string, event: ProficiencyUpdate): Promise<void>
  }
  
  // === Layer 2: Task Orchestrator ===
  taskOrchestrator: {
    create(task: TaskInput): Promise<Task>
    complete(taskId: string, outcome: TaskOutcome): Promise<LearningEvent[]>
    getStatus(taskId: string): Promise<Task>
    listActive(): Promise<Task[]>
  }
  
  // === Layer 3: Knowledge Manager ===
  knowledgeManager: {
    ingest(knowledge: KnowledgeInput): Promise<Knowledge>
    search(query: string, filters?: SearchFilters): Promise<Knowledge[]>
    associate(knowledgeId: string, skillId: string): Promise<void>
    getBySkill(skillId: string): Promise<Knowledge[]>
  }
  
  // === Layer 4: Learning Engine ===
  learningEngine: {
    processTaskCompletion(taskId: string, outcome: TaskOutcome): Promise<LearningEvent[]>
    processFeedback(feedback: UserFeedback): Promise<LearningEvent>
    detectGaps(): Promise<SkillGap[]>
    getLearningTimeline(skillId?: string): Promise<LearningEvent[]>
  }
  
  // === Layer 5: Competency Manager ===
  competencyManager: {
    getModel(): Promise<CompetencyModel>
    getSkill(skillId: string): Promise<Skill>
    updateSkill(skillId: string, update: SkillUpdate): Promise<void>
    getGrowthTrajectory(): Promise<GrowthReport>
  }
  
  // === Layer 6: Autonomy Engine ===
  autonomyEngine: {
    canActAutonomously(toolId: string, action: string): Promise<AutonomyDecision>
    getPolicy(): Promise<AutonomyPolicy>
    updatePolicy(update: Partial<AutonomyPolicy>): Promise<void>
  }
}
```

## 九、兄弟文件

- [What is Praxis?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？谁是那个"自己"？
- [Why does it exist?](why.md) — 它为什么存在
- [How does it work?](how.md) — 六层架构详解
- [When does it operate?](when.md) — 生命周期和触发点
- [Where does it sit?](where.md) — 架构定位与系统关系
