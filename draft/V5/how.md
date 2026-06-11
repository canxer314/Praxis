# How does Praxis V5 work?

## 总览：V4 全部保留 + Meta Layer

V5 保留 V4 的完整架构（六层 + 四子系统），在此之上增加 Meta Layer。Meta Layer 包含三个子系统。

```
┌──────────────────────────────────────────────────────────────┐
│                   OpenClaw Agent Loop                         │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Praxis Memory Plugin (V5)                  │  │
│  │                                                          │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │            Meta Layer (V5 NEW)                     │  │  │
│  │  │                                                    │  │  │
│  │  │  子系统 1: Structural Inadequacy Detector          │  │  │
│  │  │  子系统 2: Cognitive Structure Constructor         │  │  │
│  │  │  子系统 3: Cognitive Structure Registry            │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  V4 保留: 六层 + ProcessEngine + RoleModel +            │  │
│  │           MomentumEngine + ActionVerification +          │  │
│  │           CuriosityEngine                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Meta Layer 子系统一：Structural Inadequacy Detector

### 定位

不处理具体任务。持续监控 V4 所有子系统的**适配质量**。回答："我现有的思维框架是不是不够用？"

### 检测信号

```
┌─────────────────────────────────────────────────────────┐
│         Structural Inadequacy Detector                    │
│                                                           │
│  输入: 所有 V4 子系统的运行时数据                          │
│                                                           │
│  信号 A: 模板适配度持续低下                                │
│  ├─ 源: Process Engine                                    │
│  ├─ 检测: 同一个场景类型中，最佳 ProcessTemplate 匹配度   │
│  │        持续 < 0.3                                      │
│  └─ 含义: "没有合适的流程模板——这不是参数问题"           │
│                                                           │
│  信号 B: Action Verification 跨场景低分                    │
│  ├─ 源: Action Verification Loop                          │
│  ├─ 检测: 某个场景类型中，step_decision_accuracy 和       │
│  │        communication_effectiveness 持续低分             │
│  └─ 含义: "V4 的决策逻辑在这个场景中整体失灵"              │
│                                                           │
│  信号 C: 用户 frustration 模式                             │
│  ├─ 源: message_received 情感分析                          │
│  ├─ 检测: 在特定场景中，用户高频表达 frustration           │
│  │        ("你怎么老是不理解" / "不是这样" / "算了")       │
│  └─ 含义: "用户认为我的思维方式不适配这个场景"             │
│                                                           │
│  信号 D: 认知边界停滞                                      │
│  ├─ 源: Curiosity Engine + CompetencyModel                 │
│  ├─ 检测: 某个领域的能力模型维度长期不增长（> 4 周）       │
│  │        但用户持续分配该领域的任务                       │
│  └─ 含义: "现有的能力增长路径在这个领域不起作用"          │
│                                                           │
│  信号 E: 升级模式异常                                      │
│  ├─ 源: Momentum Engine                                    │
│  ├─ 检测: 某个场景中，升级给用户的频率显著高于其他场景     │
│  │        (> 2σ above mean)                                │
│  └─ 含义: "推动机制在这个场景中不适用"                     │
│                                                           │
│  输出: StructuralGap[] (每个 gap 有置信度)                 │
└─────────────────────────────────────────────────────────┘
```

### 聚类算法

```
当多个信号指向同一个场景类型时，汇聚为 StructuralGap:

场景类型: "谈判协商"
  信号 A: ProcessTemplate 最佳匹配度 = 0.2 (合同审核)，持续 5 次
  信号 B: step_decision_accuracy = 0.25 （远低于平均值 0.72）
  信号 C: 用户 frustration 频率 = 3/5 次
  信号 E: 升级给用户的频率 = 4/5 次 （远高于平均值 1/5 次）
  
  → 汇聚置信度: 0.85
  → StructuralGap: "线性审批框架不适配谈判场景"
```

### 与 V3 Curiosity Engine 的分工

| 检测内容 | Curiosity Engine (V3) | Structural Inadequacy Detector (V5) |
|---------|----------------------|-------------------------------------|
| "我不懂这个概念" | ✅ KnowledgeGap | — |
| "我不擅长这个工具" | ✅ 能力模型缺陷 | — |
| "我不知道下一步该干嘛" | — | 如果 ProcessTemplate 匹配度低 |
| "我反复在一个模式中失败" | — | ✅ 聚类失败 → StructuralGap |
| "用户对我的思考方式本身不满" | — | ✅ 语义分析 frustration |

---

## Meta Layer 子系统二：Cognitive Structure Constructor

### 定位

接收 StructuralGap → 分析"为什么现有框架不够" → 生成候选新结构 → 呈交人类审核。

### 构造流程

```
┌─────────────────────────────────────────────────────────┐
│       Cognitive Structure Constructor                     │
│                                                           │
│  输入: StructuralGap + 失败案例 + 成功类比                │
│                                                           │
│  Step 1: 归纳 (Induction)                                 │
│  ├─ 分析: 这些失败有什么共同的结构性原因？                │
│  │                                                         │
│  │  示例（谈判场景）:                                      │
│  │  • Process Engine 的线性步骤假设不适配:                 │
│  │    谈判不是 A→B→C, 是 A↔B↔A（回合制）                 │
│  │  • 出口条件的二元判断不适配:                            │
│  │    不是"对方确认/拒绝", 是"部分接受 + 提出替代"        │
│  │  • Momentum Engine 的 push/escalate 不适配:             │
│  │    谈判中"让步"是策略, 不是失败                         │
│  │  • Role Model 的角色关系不适配:                        │
│  │    谈判角色是"竞合"关系, 不是"协作"或"汇报"            │
│  │                                                         │
│  输出: 结构性不足的根因分析                                │
│                                                           │
│  Step 2: 假设 (Hypothesis Generation)                      │
│  ├─ 如果有一种新的认知结构 X, 它的核心概念是什么？         │
│  │                                                         │
│  │  调用 LLM 生成候选结构:                                  │
│  │  • 核心数据模型: 需要追踪什么信息？                      │
│  │  • 核心流程: 信息如何流转？                              │
│  │  • 决策逻辑: 什么时候做什么判断？                        │
│  │  • 与现有结构的接口: 从哪些现有结构获取/输出？          │
│  │                                                         │
│  输出: CandidateStructure[] (可能有多个候选)               │
│                                                           │
│  Step 3: 设计验证 (Validation Design)                      │
│  ├─ 如何验证这个新结构有效？                                │
│  │  • 成功指标是什么？                                     │
│  │  • 试点范围: 哪个场景？多少次？                          │
│  │  • 回滚条件: 什么指标下判断失败？                        │
│  │                                                         │
│  输出: StructureExperimentPlan                              │
│                                                           │
│  Step 4: 呈交 (Proposal)                                    │
│  ├─ 向用户呈现:                                    │
│  │  • 问题分析（StructuralGap + 证据）                     │
│  │  • 候选方案（新认知结构是什么、为什么这样设计）          │
│  │  • 验证计划（怎么试点、风险是什么）                     │
│  │  • 推荐（如果有多个候选，推荐哪个）                      │
│  │                                                         │
│  等待用户: 批准 / 拒绝 / 修改后重新提交                    │
└─────────────────────────────────────────────────────────┘
```

### CandidateStructure 模板

```yaml
# Praxis 向用户呈交的结构提案
CandidateStructure:
  name: "NegotiationModel"
  applies_to: ["谈判", "砍价", "合同条款协商", "资源分配争议"]
  
  problem_analysis:
    current_best_match: "合同审核流程 (适配度 0.2)"
    structural_mismatches:
      - "线性步骤 vs 回合制交互"
      - "二元决策 vs 部分接受/替代方案"
      - "推动/升级 vs 让步策略"
    evidence:
      - "5 次谈判场景，成功率 0%"
      - "用户 3 次表达 frustration"
      - "升级给用户 4/5 次"
  
  proposed_structure:
    core_concepts:
      - name: "利益映射 (Interest Map)"
        description: "双方各自的核心诉求和优先级"
      - name: "交换空间 (Trade Space)"
        description: "可以在哪些维度让步，哪些维度必须坚守"
      - name: "BATNA 追踪"
        description: "各方的最佳替代方案（谈判不成会怎样）"
      - name: "让步序列 (Concession Sequence)"
        description: "什么时候让、让多少、交换什么"
    
    core_flow: "准备→开局→探索交换空间→讨价还价→收束→确认"
    
    integration:
      uses_role_model: true          # 谈判对象从 RoleModel 获取
      uses_momentum_engine: false    # 不用推动引擎（让步不是"催促"）
      uses_process_engine: false     # 不用流程引擎（不是线性步骤）
  
  validation_plan:
    pilot_scope: "下次遇到谈判场景时激活"
    min_trials: 3
    success_criteria:
      - "step_decision 准确率 > 0.6"
      - "用户 frustration 频率 < 1/3"
      - "用户升级给用户的次数减少 50%"
    rollback_conditions:
      - "用户首次表示不满 → 暂停试点"
      - "连续 3 次失败 → 放弃此结构"
    risk_assessment: "低风险——仅影响谈判场景，不影响现有能力"

  # 用户回复:
  # ✅ "试试看" → 进入实验阶段
  # ❌ "不行，回退" → 记录为 rejected
  # 🔄 "调整X再提交" → 修改后重新提议
```

---

## Meta Layer 子系统三：Cognitive Structure Registry

### 定位

维护所有认知结构的版本化注册表。每个结构有：当前状态（crystallized/experimental/candidate/hypothesized/rejected）、验证数据、版本链、激活条件。

### 结构状态生命周期

```
┌──────────────┐
│ Hypothesized │ ← StructuralGap 被识别，但尚未构造候选结构
└──────┬───────┘
       │ Constructor Step 1-2
       ▼
┌──────────────┐
│  Candidate   │ ← 候选结构已生成，等待人类审核
└──────┬───────┘
       │ 人类批准
       ▼
┌──────────────┐
│ Experimental │ ← 限定范围内试点
└──────┬───────┘
       │ 验证通过
       ▼
┌──────────────┐
│ Crystallized │ ← 固化，全局激活
└──────┬───────┘
       │ 未来发现退化或更好的结构出现
       ▼
┌──────────────┐
│  Deprecated  │ ← 已被更好的结构取代（保留版本历史）
└──────────────┘

任何阶段都可以进入:
┌──────────────┐
│  Rejected    │ ← 人类拒绝 / 验证失败 / 发现退化
└──────────────┘
```

### 激活条件

当一个场景触发时，Praxis 如何选择使用哪个认知结构：

```
1. 精确匹配: 场景类型 → Crystallized Structure 中有精确匹配 → 激活
2. 模糊匹配: 场景类型 → 匹配多个 Crystallized Structure（适配度各有高低）
   → 选择适配度最高的
   → 如果最高适配度 < 0.3 → 触发 Structural Inadequacy Detector
3. 实验匹配: 如果是 Experimental Structure 的目标场景 → 并行激活（新旧结构同时运行，比较效果）
4. 无匹配: 适配度 = 0 → 触发 V6 Proto-Cognitive Engine（如果可用）
```

---

## V5 的完整执行流程：从"失败"到"新能力"

```
场景: 用户第 3 次让 Praxis 处理谈判

Session 中:
  message_received → "帮我跟供应商谈价格"
  
  Process Engine: 匹配模板 → 合同审核 (适配度 0.2)
    → 尝试套用 → 供应商提出替代方案 → 二元出口不适应
  
  agent_end:
    V4 Action Verification:
      step_decision_accuracy: 0.2 (低)
      communication_effectiveness: 0.3 (低)
    
    Meta Layer: Structural Inadequacy Detector ← V5 新增
      → 信号 A: 模板适配度 0.2（持续 3 次）
      → 信号 B: step_decision 准确率 0.2
      → 信号 C: 本次用户说"你不理解谈判"（frustration）
      → 汇聚: StructuralGap "谈判场景" (置信度 0.80)
      
      → 是否触发 Constructor?
        → 置信度 > 0.7 → 是
      
      → Constructor Step 1: 分析
          → 线性步骤、二元决策、推动逻辑 三个原因
      
      → Constructor Step 2: 生成候选
          → NegotiationModel (如上)
      
      → Constructor Step 4: 向用户呈交

  用户看到:
    "我注意到谈判类场景我一直处理不好。分析结果..."
    [待审核提案: NegotiationModel]
    
  用户回复: "有意思，试试看"
  
  → Registry: NegotiationModel v0.1 → status: "experimental"

下次谈判场景:
  → 匹配到 Experimental: NegotiationModel
  → 激活新结构（旧结构作为对照不激活）
  → 按 NegotiationModel 处理
  
  3 次谈判后:
  → 成功率显著提升
  → 用户满意度提升
  → Action Verification 分数提升
  
  Meta Layer 提议固化:
    "NegotiationModel 在 3 次试点中表现良好。
     成功率: 2/3 (vs 旧方式 0/5)
     建议固化。"
  
  用户: "固化"
  
  → Registry: NegotiationModel v1.0 → status: "crystallized"
  
  Praxis 多了一种思考方式。
  不是人类设计后写入的——是 Praxis 自己发现、自己构造、人类审核后固化的。
```

---

## 三条铁律

```
铁律 1: 任何新认知结构的引入必须经过人类批准
  • Praxis 可以提议，不能单方面改变自己的架构
  • "提议"包括: 分析报告 + 候选方案 + 验证计划

铁律 2: 新结构的实验必须在限定范围内
  • 先在单个场景类型试点
  • 验证通过（满足 success_criteria）后才能泛化
  • 旧结构在试点期间保留（对照 + 回滚路径）

铁律 3: 任何结构都可以被回滚
  • 固化后的结构如果导致退化 → 一键回退
  • 每个结构有完整版本链（supersedes）
  • GovernancePolicy 永远在人类控制下
```

---

## 兄弟文件

- [What is Praxis V5?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 人类角色的转变
- [Why Praxis V5?](why.md) — 为什么需要 Meta Layer
- [When does it operate?](when.md) — 结构进化生命周期
- [Where does it sit?](where.md) — Meta Layer 的位置
- [Architecture Design](design.md) — V5 架构设计文档
