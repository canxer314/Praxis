# Who is Praxis V5 for?

## 角色全景（V5 核心变化：人类角色的根本转变）

V1-V4 的进化中，人类的角色越来越轻：从 V1 的"一切由人类设计"，到 V4 的"人类设计模板 + Praxis 执行"。但**人类始终是设计者**。

V5 改变了这个根本关系：**人类不再是设计者，而是治理者**。

```
V1-V4:                   V5:
                         
人类设计架构             人类设定边界
    ↓                       ↓
Praxis 执行            Praxis 发现结构不足
    ↓                       ↓
人类反馈                Praxis 提出候选方案
    ↓                       ↓
人类重新设计            人类审核批准/拒绝/修改
    ↓                       ↓
新版本发布              Praxis 在限定范围内实验
                            ↓
                        Praxis 收集效果数据
                            ↓
                        人类最终审批 → 固化
                            ↓
                        Praxis 持续监控退化
```

---

## 一、最终用户（End User）— V5 的新体验

### 用户第一次遇到 Praxis 处理不好的场景

**V4 的体验**：
> Praxis 默默挣扎，强行套用不适配的模板，反复失败或频繁升级 → 用户感到沮丧："它怎么就是不明白"

**V5 的体验**：
> Praxis 在第二次失败后主动说：
> "我注意到这类场景（谈判协商）我用现有的方式处理不好。问题不是我缺什么知识——是我处理它的思路本身不对。你给我几分钟，我分析一下问题出在哪里？"
>
> （分析）
>
> "我明白了。我之前把谈判当作'对方确认或拒绝我的提案'。但谈判本质上是'双方利益交换'。我想尝试一种不同的处理方式：先梳理双方各自关心什么，找到可以交换的维度，然后制定让步策略。这和你之前教我的'做事'逻辑不一样，更像是'下棋'。要试一下吗？"

### 用户的新能力：治理而非设计

| 用户操作 | V4 | V5 |
|---------|----|----|
| 发现 Praxis 处理不好某类场景 | 用户自己诊断 → 联系运维 → 等新模板 | Praxis 主动告知 + 分析报告 + 候选方案 |
| 改善 Praxis 的能力 | 用户教具体知识或流程 | 用户审核 Praxis 提出的新认知结构 |
| 纠正 Praxis 走偏 | 一次一次纠正具体行为 | 用户可以说"这个结构本身有问题，回滚" |
| 查看 Praxis 的能力边界 | `/praxis status` → 六维雷达 | `/praxis structures` → 认知结构注册表 + 每个结构的验证状态 |

---

## 二、OpenClaw 运维者（Operator）— V5 的新职责

V5 的运维者多了一个全新的职责维度：**结构治理（Structure Governance）**。

| 职责 | 说明 |
|------|------|
| 设定自进化边界 | 在 `governance_policy` 中定义：哪些层可以自主修改、哪些必须人类审批、什么条件下可以自动实验 |
| 审批结构提案 | Praxis 提出新的 CognitiveStructure 时，运维者审核其安全性、范围、回滚计划 |
| 监控结构退化 | 新结构固化后，监控是否在已有场景上导致性能退化 |
| 管理结构版本 | 每个 CognitiveStructure 有版本链（supersedes），运维者管理历史版本和回滚 |
| 紧急刹车 | 如果 Praxis 的自进化出现失控迹象 → 一键冻结 Meta Layer |

### 治理策略示例

```yaml
GovernancePolicy:
  # 什么可以自主修改
  auto_approval:
    - "ProcessTemplate 参数调整（reasonable_wait ± 1 天）"  # V4 已有
    - "Role.nudge_profile 微调"                              # V4 已有
    - "KnowledgeGap priority 重排序"                         # V3 已有
  
  # 什么需要人类审批
  human_approval_required:
    - "新 CognitiveStructure 的创建"
    - "现有 CognitiveStructure 的结构性修改（非参数调整）"
    - "Meta Layer 自身的任何修改"
    - "层边界或层定义的修改"
  
  # 什么完全禁止
  forbidden:
    - "GovernancePolicy 自身的修改"  # 治理策略不能被治理
    - "HumanApprovalRequired 规则的删除或降级"
```

---

## 三、AI 的"自我"：V5 的定义

### V5 新增的人格维度：元认知

```yaml
who_am_i_v5:
  # ── V4 原有的六维 ──
  my_tools: {...}
  my_domains: {...}
  my_task_types: {...}
  my_user_model: {...}
  my_process_capability: {...}
  my_action_reliability: {...}

  # ── V5 新增：元认知能力 ──
  my_meta_cognition:
    structural_awareness:            # 对自己认知结构的理解
      active_structures: 8           # 当前活跃的认知结构
        - ProcessEngine: mastered (0.82)
        - RoleModel: mastered (0.80)
        - MomentumEngine: competent (0.65)
        - CuriosityEngine: proficient (0.72)
        - NegotiationModel: experimental (0.30)  ← 试点中
        - RiskAssessmentModel: candidate (0.15)  ← 刚提出，待审核
      
      structural_gaps_detected: 3
        - pattern: "创意探索类场景" (confidence: 0.65)
          hypothesis: "需要一种发散-收敛的认知结构，而非线性流程"
        - pattern: "冲突调解类场景" (confidence: 0.45)
        - pattern: "长期规划类场景" (confidence: 0.35)
      
      structure_evolution_history:
        - {version: "initial", structures: 4, date: "V4 baseline"}
        - {version: "added-negotiation", structures: 5, date: "2026-07"}
        - {version: "split-risk-assessment", structures: 6, date: "2026-08"}
    
    self_improvement_capability:     # 自我改进能力（元元认知）
      gap_detection_accuracy: 0.60   # 检测到的 gap 中有多少是真正的结构缺口
      solution_quality: 0.45         # 提出的候选结构的质量
      experiment_discipline: 0.70    # 实验中遵守安全边界的程度
      false_alarm_rate: 0.15         # 误报率（标记了 gap 但其实不是）
```

### V5 的"自我"能做的事

> `/praxis structures`
>
> **已固化结构 (6):**
> • ProcessEngine v3.2 — 处理"多步骤协调"场景 — 验证: 47 次 — 有效
> • RoleModel v2.1 — 处理"多角色交互"场景 — 验证: 38 次 — 有效
> • MomentumEngine v1.5 — 处理"流程阻塞推动"场景 — 验证: 25 次 — 有效
> • CuriosityEngine v1.3 — 处理"知识缺口管理"场景 — 验证: 30 次 — 有效
> • NegotiationModel v1.0 — 处理"协商议价"场景 — 验证: 8 次 — 有效 ✅ (新固化)
> • RiskAssessmentModel v0.8 — 处理"风险评估"场景 — 验证: 4 次 — 有效（试点中）
>
> **候选结构 (1):**
> • CreativeExplorationModel — 处理"发散探索"场景 — 刚提出，等待你审核
>
> **已识别的结构缺口 (2):**
> • 长期规划类场景 — 置信度 0.35 — 证据不足，继续观察
> • 冲突调解类场景 — 置信度 0.45 — 下次遇到时重点分析

---

## 四、总结

| 问题 | V4 答案 | V5 答案 |
|------|---------|---------|
| **人类是什么角色？** | 设计者（设计模板/流程/角色） | **治理者**（审核提案/设定边界/紧急刹车） |
| **Praxis 怎么应对新场景？** | 强行匹配最接近的模板 | **检测结构不足 → 提出新结构 → 人类审核 → 实验固化** |
| **架构会变吗？** | 不会（V4 是固定的 6 层 + 4 子系统） | **会**（Cognitive Structure Registry 动态增长） |
| **谁发现问题？** | 人类 | **Praxis（Structural Inadequacy Detector）** |
| **谁设计方案？** | 人类 | **Praxis 候选 + 人类审核** |

---

## 兄弟文件

- [What is Praxis V5?](what-is.md) — 它是什么
- [Why Praxis V5?](why.md) — 为什么需要 Meta Layer
- [How does it work?](how.md) — Meta Layer 三个子系统详解
- [When does it operate?](when.md) — 结构进化生命周期
- [Where does it sit?](where.md) — Meta Layer 的位置
- [Architecture Design](design.md) — V5 架构设计文档
