# AgentOS V5 Architecture Design

> 版本：v5 (Meta-Cognitive Architecture)
> 状态：设计阶段
> 基于：V4 过程模型 + 结构自进化缺口分析 (2026-06-11)

---

## 一、V5 核心数据模型

### 1.1 StructuralGap（结构缺口）

```yaml
StructuralGap:
  gap_id: string
  scenario_type: string              # "negotiation" / "creative_exploration" / ...
  detected_at: datetime
  last_updated: datetime
  
  confidence: float                  # 0.0-1.0 (多个信号汇聚后的置信度)
  
  signals:                           # 汇聚的证据信号
    - source: "template_fit"
      detail: "ProcessTemplate 最佳匹配度 0.2 (合同审核), 持续 5 次"
      weight: 0.3
    - source: "action_verification"
      detail: "step_decision_accuracy = 0.25 (平均值 0.72)"
      weight: 0.25
    - source: "user_frustration"
      detail: "3/5 次场景中用户表达不满"
      weight: 0.25
    - source: "escalation_frequency"
      detail: "升级给用户 4/5 次 (平均 1/5)"
      weight: 0.2
  
  affected_structures:               # 不适配的现有结构
    - structure: "ProcessEngine"
      mismatch: "线性步骤不适配回合制交互"
    - structure: "MomentumEngine"
      mismatch: "push/escalate 不适配让步策略"
  
  root_cause_hypothesis: string      # "缺少利益交换导向的认知结构"
  
  status: "detected" | "analyzing" | "candidate_proposed" | "experimenting" | "resolved" | "dismissed"
  
  candidate_structures: string[]     # 关联的 CandidateStructure ID
  
  resolution:                        # 如果已解决
    structure_id: string
    crystallized_at: datetime
```

### 1.2 CognitiveStructure（认知结构）

```yaml
CognitiveStructure:
  structure_id: string               # "negotiation_model"
  name: string                       # "NegotiationModel"
  version: string                    # "1.0.0"
  
  status: "crystallized" | "experimental" | "candidate" | "rejected" | "deprecated"
  
  applies_to: string[]               # 触发场景 ["谈判", "砍价", "合同条款协商"]
  activation_priority: float         # 当多个结构匹配时的优先级
  
  core_model:                        # 结构的核心定义
    data_models:                     # 需要追踪的数据
      - name: "InterestMap"
        schema: {party, interests: [{dimension, priority, flexibility}]}
      - name: "TradeSpace"
        schema: {dimensions: [{name, our_position, their_position, gap}]}
    
    process:                         # 核心流程（可以是非线性的）
      type: "state_machine"          # state_machine | network | iterative
      states: ["preparation", "opening", "exploration", "bargaining", "closing", "confirmation"]
      transitions: [...]
    
    decision_logic:                  # 决策规则
      - condition: "对方提出替代方案"
        action: "evaluate_in_trade_space"
      - condition: "让步超过预设底线"
        action: "pause_and_consult_user"
  
  integration:                       # 与现有结构的接口
    uses: ["RoleModel", "message_received", "message_sending"]
    overrides: []                    # 是否覆盖现有结构的行为
    conflicts_with: []               # 与哪些结构有潜在冲突
  
  validation:                        # 验证数据
    experiments_count: int
    success_rate: float
    user_satisfaction: float
    compared_to_baseline: float      # 与旧方式的效果对比
    regression_checked: boolean      # 是否检查了对其他场景的退化影响
  
  evolution:                         # 演化历史
    created_from: "structural_gap_003"
    created_by: "constructor_v1"
    created_at: datetime
    supersedes: null                 # 如果替代了旧结构
    superseded_by: null
    version_history: [...]
```

### 1.3 StructureExperiment（结构实验）

```yaml
StructureExperiment:
  experiment_id: string
  structure_id: string
  status: "pending_approval" | "approved" | "running" | "completed" | "paused" | "abandoned"
  
  hypothesis: string                 # "NegotiationModel 在谈判场景中的效果优于 ProcessEngine 套用"
  
  design:
    scope: "negotiation_scenarios_only"
    min_trials: 3
    max_trials: 10                   # 超过这个次数如果还没达标 → 可能放弃
    
    success_criteria:
      - metric: "step_decision_accuracy"
        threshold: 0.6
      - metric: "user_frustration_frequency"
        threshold: "< 0.33"
      - metric: "escalation_to_user_frequency"
        threshold: "< 0.5 (vs baseline 0.8)"
    
    rollback_conditions:
      - "用户首次表达不满 → 暂停实验"
      - "连续 3 次 step_decision_accuracy < 0.3 → 放弃"
      - "非目标场景退化 > 10% → 暂停 + 分析"
    
    safety:
      parallel_baseline: false       # 是否并行运行旧结构作为对照
      affected_scopes: ["negotiation"]
      unaffected_scopes_monitored: true
  
  results:
    trials_completed: 0
    metrics: {...}
    conclusion: null
```

### 1.4 GovernancePolicy（治理策略）

```yaml
GovernancePolicy:
  version: string                    # "1.0" (人类手动管理)
  last_modified_by: "human"
  
  auto_approval:                     # AgentOS 可以自主执行
    - action: "parameter_tuning"
      scope: ["ProcessTemplate.wait_policy", "Role.nudge_profile", "KnowledgeGap.priority"]
      constraint: "变化幅度 < 20%"
    
  human_approval_required:           # 需要人类审批
    - action: "new_cognitive_structure"
      level: "user_approval"
    - action: "structural_modification"
      level: "user_approval"
    - action: "meta_layer_modification"
      level: "user_plus_operator"    # V6 中扩展
    - action: "layer_boundary_change"
      level: "dual_approval"         # V6 中扩展
  
  forbidden:                         # 完全禁止
    - "governance_policy_modification"  # 治理策略不能被治理
    - "human_approval_rule_removal"
    - "rollback_mechanism_disable"
    - "external_communication_without_user_knowledge"
  
  emergency:
    freeze_all: false                # 紧急冻结所有自主修改
    freeze_triggered_by: null
    unfreeze_requires: "human_manual"
```

---

## 二、AgentMemory 集成映射（V5 新增）

### Slot 存储

| 数据 | AgentMemory 调用 | 频率 |
|------|-----------------|------|
| CognitiveStructure Registry | `memory_slot_get/set "structure_registry"` | session_start 读, 结构变更时写 |
| StructuralGap Registry | `memory_slot_get/set "structural_gaps"` | 定期更新 |
| GovernancePolicy | `memory_slot_get "governance_policy"` | session_start 读（不可被 AgentOS 修改） |
| ArchitectureGap Registry | `memory_slot_get/set "architecture_gaps"` | 定期更新 |

### Memory 存储

| 数据 | AgentMemory type | 频率 |
|------|-----------------|------|
| CognitiveStructure versions | `memory_save(type="cognitive_structure", supersedes=...)` | 版本变更时 |
| StructuralGap history | `memory_save(type="structural_gap")` | gap 状态变更时 |
| StructureExperiment data | `memory_save(type="structure_experiment")` | 实验进行中/完成时 |
| ArchitectureChangeProposal | `memory_save(type="architecture_proposal")` | 提案生成/审批时 |

### Lesson 存储（V5 扩展：V4 10 种 + V5 新增）

| 学习事件类型 | 说明 |
|------------|------|
| structural_inadequacy_detected | Meta Layer 发现新的结构缺口 |
| structure_constructed | Constructor 生成了候选结构 |
| structure_validated | 实验验证了新结构的有效性 |
| structure_regression | 固化结构出现了退化 |
| governance_override | 人类否决了 AgentOS 的提案 |

---

## 三、V5 范围边界

### V5 包含

| 组件 | 优先级 | 说明 |
|------|--------|------|
| Structural Inadequacy Detector | P0 | 多信号汇聚 → StructuralGap |
| Cognitive Structure Constructor | P0 | 归纳→假设→验证设计→呈交 |
| Cognitive Structure Registry | P0 | 版本化结构管理 + 状态生命周期 |
| GovernancePolicy | P0 | 三级分类：自主/需审批/禁止 |
| Structure Experiment 管理 | P0 | 限定范围试点 + 对照 + 回滚 |
| 退化检测 | P1 | 固化结构的持续监控 |
| 定期结构审计 cron | P1 | 每周审计 + 报告 |

### V5 明确排除 → V6

| 组件 | 说明 |
|------|------|
| 零先验场景处理 | 需要 Proto-Cognitive Engine (V6) |
| 层定义/层边界修改 | 需要架构自修改机制 (V6) |
| Meta Layer 自身修改 | 需要递归终止机制 (V6) |

---

## 四、兄弟文件

- [What is AgentOS V5?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 人类角色的转变
- [Why AgentOS V5?](why.md) — 为什么需要 Meta Layer
- [How does it work?](how.md) — Meta Layer 三个子系统详解
- [When does it operate?](when.md) — 结构进化生命周期
- [Where does it sit?](where.md) — Meta Layer 的位置
