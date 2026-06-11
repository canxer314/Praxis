# Praxis V6 Architecture Design

> 版本：v6 (Proto-Cognitive Engine + Layer Self-Modification)
> 状态：设计阶段
> 基于：V5 Meta-Cognitive Architecture + 零先验场景分析 (2026-06-11)

---

## 一、V6 核心数据模型

### 1.1 SalientElement（感知标记）

```yaml
SalientElement:
  element_id: string
  scenario_id: string                # 所属的零先验场景
  
  raw_observation: string            # 原始观察 "穿白衣服的人让奶奶张开嘴"
  element_type: "entity" | "action" | "place" | "relation" | "attribute"
  
  salience_signals:                  # 为什么这个元素被标记
    - type: "repetition"
      detail: "3 次场景中出现'挂号'"
    - type: "user_emphasis"
      detail: "用户说'一定要先挂号'"
    - type: "sequence_position"
      detail: "总是在其他动作之前出现"
  
  tentative_label: string | null     # "挂号?" (带问号, 表示未确认)
  confidence: float | null           # 标签置信度
  
  observations:                      # 每次观察记录
    - {timestamp, context, detail}
  
  related_elements: string[]         # 频繁共现的元素
  contradictions: string[]           # 与该元素矛盾的观察
```

### 1.2 ProtoSequence（原型序列）

```yaml
ProtoSequence:
  proto_id: string
  scenario_id: string
  
  sequence:                          # 序列中的步骤（带置信度）
    - position: 1
      element_ref: "salient_003"     # 引用 SalientElement
      tentative_label: "挂号"
      confidence: 0.75               # 这个位置是这个元素的置信度
    - position: 2
      element_ref: "salient_007"
      tentative_label: "等待叫号"
      confidence: 0.60
    - position: 3
      element_ref: "salient_012"
      tentative_label: "医生问诊"
      confidence: 0.65
  
  variants:                          # 发现的变体
    - variant_id: "急诊模式"
      differences: ["跳过 step 2", "step 3 更快"]
      occurrence_count: 2
      confidence: 0.45
  
  evidence:
    total_observations: 8
    sequence_confirmed: 6            # 6/8 次符合这个序列
    sequence_broken: 2               # 2/8 次不符合
    breaks_detail: [...]
  
  open_questions:                    # 待验证问题
    - "什么条件下是标准流程 vs 急诊模式？"
  
  confidence_trend:                  # 置信度演变
    - {after_observation: 1, confidence: 0.1}
    - {after_observation: 3, confidence: 0.35}
    - {after_observation: 5, confidence: 0.55}
    - {after_observation: 8, confidence: 0.75}
```

### 1.3 ProtoRole（原型角色）

```yaml
ProtoRole:
  proto_id: string
  scenario_id: string
  
  tentative_name: string             # "医生?" (带问号)
  
  defining_behaviors:                # 定义这个角色的行为
    - behavior: "问健康相关问题"
      confidence: 0.80
    - behavior: "操作检查设备"
      confidence: 0.30               # 可能不是医生的职责
    - behavior: "给出判断/结论"
      confidence: 0.70
  
  distinguishing_from:               # 与其他 ProtoRole 的区别
    - other_role: "proto_role_nurse"
      differences: ["医生问问题+做判断", "护士执行操作+引导流程"]
      boundary_clarity: 0.65         # 边界清晰度
  
  communication_style_observed:      # 观察到的沟通模式
    formality: "professional"
    verbosity: "medium"
    typical_phrases: ["哪里不舒服", "去检查一下", "问题不大"]
  
  relationship_to_scenario:          # 在场景中的位置
    appears_in_steps: [3, 5]         # ProtoSequence 的 step 3 和 5
    role_in_scenario: "diagnoser_and_decider" (置信度 0.65)
```

### 1.4 ProtoConcept（原型概念）

```yaml
ProtoConcept:
  proto_id: string
  scenario_id: string
  
  tentative_name: string             # "医院?"
  
  defining_features:                 # 定义特征
    - feature: "穿白衣服的人很多"
      confidence: 0.90
    - feature: "有'挂号''检查''开药'等行为"
      confidence: 0.75
    - feature: "目的是诊断和治疗"
      confidence: 0.55
  
  category_hypothesis:              # 这是什么类型的场所/概念
    hypotheses:
      - label: "医疗服务场所"
        confidence: 0.60
      - label: "公共服务机构"
        confidence: 0.50
    # 多个假设可以共存——Praxis 还没确定
  
  differentiating_from:              # 与类似概念的区别
    - similar_concept: "体检中心"
      difference: "体检是预防性的, 这里是处理已有问题的"
      confidence: 0.40
```

### 1.5 ProtoPurpose（原型目的）

```yaml
ProtoPurpose:
  proto_id: string
  scenario_id: string
  
  hypothesis: string                 # "这个场景的目的似乎是诊断和解决健康问题"
  confidence: 0.50
  
  supporting_evidence:
    - "大多数行为围绕'找出问题'和'尝试解决'展开"
    - "离开时有'好了'或'按时吃药'等收束性话语"
  
  counter_evidence:
    - "有些人来了之后没有'解决'——直接被要求'住院'"
    - "这不一定是'解决不了', 可能是'需要更长时间解决'"
  
  alternative_hypotheses:
    - "分流和分诊——把严重程度不同的人分开处理" (置信度 0.30)
```

### 1.6 StructureEvolution（结构演化追踪）

```yaml
StructureEvolution:
  evolution_id: string
  
  from:                              # 演化来源
    type: "proto_structure" | "crystallized_structure" | "external_template"
    source_id: string
  
  to:                                # 演化目标
    type: "crystallized_structure" | "proto_structure" | "deprecated"
    target_id: string
  
  reason: "confidence_threshold_reached" | "regression_detected" | "user_correction" | "scenario_split"
  
  transformation:                    # 具体的转变
    proto_to_crystallized:           # 如果是原型→固化
      proto_confidence_at_crystallization: 0.82
      observations_used: 8
      crystallized_as: "hospital_visit_template"
    
    crystallized_to_proto:           # 如果是退化
      regression_cause: "发现'住院'分支不适配门诊流程"
      counter_examples: 4
      degraded_at: datetime
  
  human_involvement:                 # 人类参与
    review_required: true
    reviewer: "user"
    decision: "approved" | "rejected" | "modified"
```

### 1.7 ArchitectureChangeProposal（架构变更提案）

```yaml
ArchitectureChangeProposal:
  proposal_id: string
  level: 3 | 4 | 5                   # 变更级别
  
  detected_gap:                      # 触发的架构缺口
    gap_type: "layer_boundary_ambiguity" | "structural_organization" | "meta_layer_blindspot"
    description: string
  
  proposed_change:
    type: "merge_layers" | "split_layer" | "add_layer" | "restructure_organization" | "modify_meta_layer"
    
    affected_components: string[]    # 受影响的层/子系统
    new_organization:                # 提议的新组织方式
      description: string
      rationale: string
    
    impact_analysis:
      scenarios_improved: string[]
      scenarios_at_risk: string[]
      migration_complexity: "low" | "medium" | "high"
  
  validation_plan:
    parallel_run_days: int           # 新旧并行运行天数
    rollback_plan: string
    success_metrics: [...]
  
  approval:
    user_approved: boolean | null
    operator_approved: boolean | null
    external_reviewed: boolean | null  # Level 5 要求
    approved_at: datetime | null
  
  implementation:
    status: "proposed" | "approved" | "piloting" | "migrating" | "completed" | "rolled_back"
    started_at: datetime | null
    completed_at: datetime | null
```

---

## 二、完整信息演化管道

```
┌─────────────────────────────────────────────────────────────┐
│              Information Evolution Pipeline                   │
│                                                               │
│  Raw Observation                                              │
│  "一个穿白衣服的人说'下一个'"                                │
│       │                                                       │
│       │ Open Perception                                       │
│       ▼                                                       │
│  SalientElement                                               │
│  {label: "白衣服的人", type: entity, salience: 0.7}          │
│       │                                                       │
│       │ Proto-Construction (共现检测)                          │
│       ▼                                                       │
│  ProtoRole (置信度 0.35)                                      │
│  {name: "医生?", behaviors: ["喊下一个", "问问题"]}           │
│       │                                                       │
│       │ Interactive Validation (8 次观察)                     │
│       ▼                                                       │
│  ProtoRole (置信度 0.85)                                      │
│  {name: "医生", behaviors: [...已验证...]}                   │
│       │                                                       │
│       │ Crystallization                                       │
│       ▼                                                       │
│  CandidateStructure                                           │
│  Role "医生" → 纳入 RoleRegistry                             │
│       │                                                       │
│       │ Human Approval                                        │
│       ▼                                                       │
│  Crystallized Structure                                       │
│  Role "医生" v1.0 — 可复用, 可匹配, 可被优化                │
│       │                                                       │
│       │ Continuous Monitoring                                 │
│       ▼                                                       │
│  退化检测 → 如果退化 → 重新进入 Proto 状态                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、架构稳定性机制

```yaml
ArchitectureStability:
  # 不可变的核心
  immutable:
    - governance_policy              # 只能人类编辑
    - human_approval_requirement     # 不能被删除或降级
    - rollback_capability            # 必须始终保持
    - emergency_freeze               # 人类的一键暂停
  
  # 受控可变的
  controlled_mutable:
    cognitive_structures:            # Level 1-2
      modification_speed: "fast"     # 数天到数周
      approval: "user"
    
    layer_definitions:               # Level 3-4
      modification_speed: "slow"     # 数周到数月
      approval: "dual"
      frequency_limit: "1/month"
    
    meta_layer:                      # Level 5
      modification_speed: "very_slow" # 数月
      approval: "dual + external"
      frequency_limit: "1/quarter"
  
  # 退化护栏
  regression_guardrails:
    core_metrics:                    # 由人类定义, 不可被 Praxis 修改
      - task_success_rate
      - user_satisfaction
      - action_reliability
    degradation_threshold: 0.05      # 核心指标退化 > 5% → 自动暂停
    auto_pause: true
    notification: "immediate"
```

---

## 四、AgentMemory 集成映射（V6 新增）

### Slot 存储

| 数据 | AgentMemory 调用 | 频率 |
|------|-----------------|------|
| Active ProtoStructures | `memory_slot_get/set "proto_structures"` | session_start 读, 场景中持续更新 |
| Architecture Version | `memory_slot_get/set "architecture_version"` | 架构变更时 |
| Stability Config | `memory_slot_get "stability_config"` | session_start 读（人类管理） |

### Memory 存储

| 数据 | AgentMemory type |
|------|-----------------|
| SalientElement | `memory_save(type="salient_element")` |
| ProtoSequence / ProtoRole / ProtoConcept / ProtoPurpose | `memory_save(type="proto_structure")` |
| StructureEvolution | `memory_save(type="structure_evolution")` |
| ArchitectureChangeProposal | `memory_save(type="architecture_proposal")` |

### Lesson 存储（V6 扩展：V5 + V4 15 种 + V6 新增）

| 学习事件类型 | 说明 |
|------------|------|
| zero_prior_entered | 首次进入零先验场景 |
| salient_element_identified | 标记了一个 salient 元素 |
| proto_structure_formed | 从共现中形成了原型 |
| proto_confidence_milestone | 原型置信度跨越关键阈值 (0.5, 0.8) |
| structure_crystallized_from_proto | 原型固化为结构 |
| structure_degraded_to_proto | 固化结构退化为原型 |
| architecture_modified | 架构组织方式被修改 |
| emergency_freeze_triggered | 紧急冻结被触发 |

---

## 五、V1 → V6 完整差异

| 维度 | V1 | V2 | V3 | V4 | V5 | V6 |
|------|----|----|----|----|----|----|
| 运行环境 | Claude Harness | OpenClaw Plugin | 同 V2 | 同 V2 | 同 V2 | 同 V2 |
| 任务模型 | 工具链 | 工具链 | 工具链 | 过程网络 | 过程+结构演化 | **过程+结构演化+零先验** |
| 角色认知 | 无 | 用户(隐式) | UserModel | RoleRegistry | RoleRegistry | **RoleRegistry+ProtoRole** |
| 能力维度 | 1D | 1D | 4D | 6D | **7D**(+元认知) | **8D**(+原型认知) |
| 知识形式 | 无分类 | 无分类 | 5类 | 5类 | 5类+结构 | **5类+结构+原型(概率性)** |
| 学习事件 | 1 | 1 | 5 | 10 | 15 | **23** |
| Hook数 | 自建 | 5 | 6 | 7 | 7 | 7 |
| 认知结构 | 固定6层 | 固定6层 | 固定6层 | 固定6层+4子系统 | **动态+Meta Layer** | **动态+层可修改** |
| 架构可改? | ❌ | ❌ | ❌ | ❌ | 结构可增改 | **层可改** |
| 零先验? | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 人类角色 | 设计者 | 设计者 | 设计者 | 设计者 | 治理者 | **递归终止** |

---

## 六、兄弟文件

- [What is Praxis V6?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 人类作为递归终止条件
- [Why Praxis V6?](why.md) — 为什么需要 Proto-Cognitive Engine
- [How does it work?](how.md) — Proto-Cognitive Engine 四阶段详解
- [When does it operate?](when.md) — 零先验场景生命周期
- [Where does it sit?](where.md) — 原型→固化的演化路径
