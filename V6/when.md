# When does Praxis V6 operate?

## V6 触发模型：V5 全部保留 + 零先验场景 + 层自修改

V5 的触发模型完全保留。V6 新增两类触发：零先验场景触发（激活 Proto-Cognitive Engine）和架构级问题触发（激活层自修改流程）。

```
触发类型              触发点                              V5    V6
──────────────────────────────────────────────────────────────
V5 全部保留           所有 V5 触发点                       ✅    ✅
──────────────────────────────────────────────────────────────
V6 新增                场景适配度 = 0                      ❌    ✅ Proto-Cognitive Engine
V6 新增                ProtoStructure 置信度达标           ❌    ✅ 固化提议
V6 新增                固化结构持续遇到反例                 ❌    ✅ 退化回原型
V6 新增                ArchitectureGap 检测                ❌    ✅ 层修改流程
V6 新增                层修改 Level 3-5 审批               ❌    ✅ 多级人类审核
V6 新增                架构退化 > 阈值                      ❌    ✅ 自动暂停 + 回滚
```

---

## 零先验场景的完整生命周期

```
┌────────────────────────────────────────────────────────────┐
│          Zero-Prior Scenario Lifecycle                       │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Stage 0: 进入陌生场景                                 │   │
│  │                                                       │   │
│  │ 触发: message_received → 场景分类                    │   │
│  │                                                   │   │
│  │ Praxis:                                              │   │
│  │ → 遍历所有 Crystallized CognitiveStructure           │   │
│  │ → 最佳匹配适配度 = 0                                  │   │
│  │ → 遍历所有 Experimental Structure → 无匹配           │   │
│  │ → 结论: 零先验场景                                    │   │
│  │ → 声明: "这是我完全不了解的场景"                      │   │
│  │ → 激活: Proto-Cognitive Engine                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Stage 1: 开放感知（持续多个会话）                     │   │
│  │                                                       │   │
│  │ 每次该场景出现时:                                     │   │
│  │                                                       │   │
│  │ message_received:                                     │   │
│  │ → 标记 SalientElement（不分类）                       │   │
│  │ → 生成感知性问题（受 Curiosity 治理）                 │   │
│  │                                                       │   │
│  │ agent_end:                                            │   │
│  │ → 汇总本轮新标记的 SalientElement                     │   │
│  │                                                       │   │
│  │ session_end:                                          │   │
│  │ → 如果观察次数 > 2: 检测共现模式                      │   │
│  │ → 生成 ProtoStructure（如检测到模式）                 │   │
│  │                                                       │   │
│  │ 本阶段持续时间: 1-N 次场景出现                         │   │
│  │ 退出条件: 至少 1 个 ProtoStructure 置信度 > 0.5      │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Stage 2: 互动验证（每次场景出现）                     │   │
│  │                                                       │   │
│  │ 每次该场景出现时:                                     │   │
│  │                                                       │   │
│  │ session_start:                                        │   │
│  │ → 加载活跃的 ProtoStructure                           │   │
│  │                                                       │   │
│  │ 场景中:                                               │   │
│  │ → ProtoStructure 置信度 > 0.5 → 尝试按原型引导行动   │   │
│  │ → 成功: 置信度 +0.1                                   │   │
│  │ → 失败: 置信度 -0.2 + 记录反例                       │   │
│  │ → 主动提问（精化原型）                                │   │
│  │                                                       │   │
│  │ agent_end:                                            │   │
│  │ → 更新所有 ProtoStructure 置信度                      │   │
│  │ → 检查是否有 ProtoStructure 达到固化条件              │   │
│  │                                                       │   │
│  │ session_end:                                          │   │
│  │ → ProtoStructure 状态快照                             │   │
│  │ → 如果置信度在下降 → 标记关注                         │   │
│  │                                                       │   │
│  │ 本阶段持续时间: 直到固化条件满足                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Stage 3: 固化 / 退化循环（持续）                      │   │
│  │                                                       │   │
│  │ 固化:                                                 │   │
│  │ → ProtoStructure 核心维度置信度 > 0.8                 │   │
│  │ → 生成 CandidateStructure                            │   │
│  │ → 提交人类审核                                        │   │
│  │ → 批准 → 纳入 Registry → 状态: crystallized          │   │
│  │ → 后续: 该场景不再触发 Proto-Cognitive Engine        │   │
│  │         转而使用固化的结构（正常的 V5 流程）          │   │
│  │                                                       │   │
│  │ 退化:                                                 │   │
│  │ → 固化结构持续遇到反例 (> 3 次)                       │   │
│  │ → 或预测准确率下降到 < 0.7                            │   │
│  │ → 标记 "degraded" → 重新激活为 ProtoStructure        │   │
│  │ → 保留已有数据，新反例作为修正信号                    │   │
│  │ → 重新进入 Stage 2                                    │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

---

## 层自修改的触发时机

```
触发条件: Structural Inadequacy Detector 发现某个认知结构
          "无处安放"——它在现有层中跨了多个边界、或者无法被
          任何一层完整地描述。

agent_end / session_end:
  → Detector 发现 ArchitectureGap (不是普通的 StructuralGap)
  → 升级到 ArchitectureGap Registry

每周 cron (Architecture Audit):
  → 审查 ArchitectureGap 置信度
  → 如果 gap 置信度 > 0.7 且持续 > 2 周:
      → 激活层修改 Constructor
      → 生成 ArchitectureChangeProposal
  → 如果 gap 涉及 Level 4+:
      → 额外标记为 "需要运维者关注"

呈交时机:
  → 下一个月度审核窗口（不是实时——架构变更不紧急）
  → 向用户 + 运维者呈交 ArchitectureChangeProposal
```

### 层修改的时间约束

```
┌─────────────────────────────────────────────────────────┐
│            Temporal Constraints on Self-Modification      │
│                                                           │
│  Level 3 (结构修改):                                      │
│  • 提案频率: 无限制（但每个提案独立审核）                │
│  • 试点时间: 至少 10 次场景触发                          │
│                                                           │
│  Level 4 (层定义修改):                                    │
│  • 提案频率: 每月最多 1 次                                │
│  • 试点时间: 至少 30 天                                   │
│  • 新旧并行: 整个试点期间                                │
│                                                           │
│  Level 5 (Meta Layer 修改):                               │
│  • 提案频率: 每季度最多 1 次                              │
│  • 试点时间: 至少 60 天                                   │
│  • 额外要求: 外部专家审核（可选）+ 用户签署              │
│                                                           │
│  Level 6 (GovernancePolicy 修改):                         │
│  • Praxis 不能提议                                       │
│  • 只能人类手动编辑配置文件                              │
│  • 修改后全局生效（无试点）                              │
│                                                           │
│  紧急刹车:                                                │
│  • 用户随时可以: /praxis architecture freeze            │
│  • 冻结期间: 所有 Level 3+ 修改暂停                      │
│  • 解冻: 手动 (用户或运维者)                              │
└─────────────────────────────────────────────────────────┘
```

---

## 用户命令（V6 新增）

| 命令 | 功能 |
|------|------|
| `/praxis perceive` | 查看当前零先验场景的感知状态（SalientElement + ProtoStructure） |
| `/praxis proto <id>` | 查看某个原型的详细信息 + 置信度历史 |
| `/praxis proto <id> correct` | 纠正某个原型（加速精化） |
| `/praxis architecture` | 查看当前架构版本 + 层定义 |
| `/praxis architecture proposals` | 查看待审批的架构变更提案 |
| `/praxis architecture freeze` | 紧急冻结所有 Level 3+ 修改 |
| `/praxis architecture unfreeze` | 解冻 |
| `/praxis architecture rollback <version>` | 回滚架构到指定版本 |

---

## 兄弟文件

- [What is Praxis V6?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 人类作为递归终止条件
- [Why Praxis V6?](why.md) — 为什么需要 Proto-Cognitive Engine
- [How does it work?](how.md) — Proto-Cognitive Engine 四阶段详解
- [Where does it sit?](where.md) — 原型→固化的演化路径
- [Architecture Design](design.md) — V6 架构设计文档
