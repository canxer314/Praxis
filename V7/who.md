# Who is Praxis V7 for?

> V7 定义了三个角色：开发者（写代码）、运维者（管运行）、用户（用系统）。V6 的"人类"在 V7 中被拆解为这三个角色的具体职责。

---

## 一、角色三角

```
              ┌──────────┐
              │  用户     │
              │ (User)    │
              └─────┬─────┘
                    │ 使用 Praxis 完成工作
                    │ 教 Praxis 业务知识
                    │ 审核认知结构提案
                    │ 纠正错误认知
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  开发者   │  │  运维者   │  │  Praxis │
│(Developer)│  │(Operator) │  │  自身     │
└──────────┘  └──────────┘  └──────────┘
 写插件代码     管运行环境      执行编排
 设计 Prompt    审 Level 4+    注入上下文
 调试 Hook      紧急冻结       存储记忆
 版本管理       监控退化       更新置信度
```

---

## 二、开发者（Developer）

### 职责

开发者不参与 Praxis 的日常运行。开发者构建和迭代 Praxis 插件本身。

| 职责 | 具体工作 |
|------|---------|
| **Hook 处理器实现** | 编写 `message_received`、`session_start`、`session_end`、`agent_end`、cron 回调 |
| **Prompt 模板设计** | 设计系统提示注入片段的结构（ProtoStructure 如何序列化、感知指令如何措辞） |
| **数据模型实现** | 定义 SalientElement、ProtoStructure 等的 TypeScript 类型和 AgentMemory 存储格式 |
| **编排逻辑** | 决定哪个 Hook 中做什么操作、数据如何在不同 Hook 之间流转 |
| **AgentMemory 集成** | 调用 memory_save、memory_slot_*、memory_patterns 等 API |
| **置信度算法** | 实现置信度更新公式（预测成功 +0.1、失败 -0.2、权重衰减等） |
| **测试与调试** | 验证 SalientElement 质量、ProtoStructure 准确率、Hook 性能 |

### 开发者不需要做的事

- ❌ 不需要替用户设计认知结构（那是 Praxis + 用户协作的事）
- ❌ 不需要理解每个用户的业务领域（那是 Praxis 学的事）
- ❌ 不需要手动管理 AgentMemory 中的数据（那是 Praxis 编排的事）

### 开发者的关键设计决策

```
决策 1: 系统提示注入策略
  ├─ 全量注入: session_start 加载所有相关 ProtoStructure → 全部注入 prompt
  │   优点: 信息完整
  │   缺点: 占用大量 token
  │
  └─ 按需注入: session_start 只注入"当前场景"相关的结构
      当 Agent 执行到特定步骤时，通过 before_tool_call 注入该步骤相关的结构
      优点: token 效率高
      缺点: 实现复杂

V7 推荐: 按需注入。场景匹配 → 注入顶层结构 → 具体步骤 → 注入步骤级提示。

决策 2: SalientElement 存储粒度
  ├─ 每条消息存一个 SalientElement → 数据碎片多
  └─ 每会话存一个 SalientElement 集合 → 数据集中但丢失时序
  V7 推荐: 会话级集合 + 保留元素出现的时间顺序。

决策 3: ProtoStructure 更新策略
  ├─ 实时更新: 每次 agent_end 立即更新 → 数据最新但写操作频繁
  └─ 批量更新: session_end 一次性更新 → 减少写操作但可能丢失中间状态
  V7 推荐: 混合。置信度在 agent_end 内存中更新，session_end 持久化。
```

---

## 三、运维者（Operator）

### 职责

运维者负责 Praxis 的运行环境健康和高级架构治理。运维者不一定是用 Praxis 完成日常任务的人。

| 职责 | 具体工作 |
|------|---------|
| **架构版本管理** | 审批 Level 3+ 的结构变更，管理架构版本号 |
| **监控与告警** | 关注退化报告、性能指标、异常冻结 |
| **紧急干预** | 执行 `/praxis architecture freeze`，回滚架构版本 |
| **配置管理** | 编辑 GovernancePolicy，设置退化阈值和审批规则 |
| **外部审核** | 当 Level 5 变更需要外部视角时，引入专家审核 |

### 运维者的审批权限

```
┌─────────────────────────────────────────────────────────┐
│                运维者审批矩阵                              │
│                                                           │
│  变更级别          开发者  用户    运维者  外部专家        │
│  ─────────────────────────────────────────────────────    │
│  Level 1 (参数调整)  设计   -       -       -            │
│                      (Praxis 自主)                       │
│                                                           │
│  Level 2 (新结构)     实现   审核   知悉    -            │
│                                                           │
│  Level 3 (结构重组)   实现   审核   ✅审核   -            │
│                                                           │
│  Level 4 (层定义)     提案   审核   ✅审核   可选         │
│                      (需运维者批准试点范围)                │
│                                                           │
│  Level 5 (Meta)       提案   审核   ✅审核   ✅建议       │
│                                                           │
│  Level 6 (Governance) 不可提议  手动编辑  手动编辑  -    │
│                                                           │
│  紧急冻结               -    可触发  ✅可触发  -          │
│  版本回滚               -    可请求  ✅可执行  -          │
└─────────────────────────────────────────────────────────┘
```

### 运维者与用户的区别

| 场景 | 用户 | 运维者 |
|------|------|--------|
| Praxis 提议一个新认知结构 | 审核业务合理性（"这个结构对吗？"） | 审核架构一致性（"这个结构放在哪里？"） |
| 核心指标退化 > 5% | 收到通知（"Praxis 表现变差了"） | 收到告警 + 启动诊断（"哪里出问题了？"） |
| 架构回滚 | 请求回滚（"回到昨天的版本"） | 执行回滚（审批 + 迁移数据） |
| 修改 GovernancePolicy | 不能修改 | 手动编辑配置文件 |

---

## 四、用户（User）

### V7 中用户角色的变化

V6 定义了"人类作为递归终止条件"和"感知教练"。V7 将这些转化为具体的交互模式。

### 交互模式 1：静默观察模式（Phase 1）

```
Praxis 进入陌生场景 → 只观察，不提问
  ├─ 在系统提示中静默注入感知指令
  ├─ session_end 分析 SalientElement
  ├─ Praxis 不主动打断用户
  └─ 用户可以用 /praxis perceive 查看 Praxis 观察到了什么
```

### 交互模式 2：感知确认模式（Phase 2）

```
session_start（当场景的 SalientElement > 5 时）:
  Praxis 在第一条回复末尾附加观察摘要:
  
  "📝 我对这个场景的观察（第 3 次）:
   • 挂号→等待→被问 似乎形成序列 (置信度 0.45)
   • 穿白衣服的人有两种: 问问题的和做检查的 (置信度 0.35)
   
   以上理解对吗？有需要纠正的吗？"
  
  → 用户可以纠正（"医生问问题+做判断，护士执行操作"）
  → 纠正被记录为高权重信号（用户明确纠正 > 统计推断）
```

### 交互模式 3：固化审批模式（Phase 3）

```
ProtoStructure 置信度达标 → Praxis 提议固化:

  "/praxis crystallize 提议:
   将 '医院门诊流程' 固化为可复用模板
   观察次数: 8, 核心置信度: 0.85
   固化为: ProcessTemplate 'hospital_outpatient_visit'
   
   批准? /praxis crystallize approve
   拒绝? /praxis crystallize reject [原因]
   修改? /praxis crystallize edit '描述修正'"
```

### 用户的新命令（V7 实现）

| 命令 | 功能 | Phase |
|------|------|-------|
| `/praxis perceive` | 查看当前场景的感知状态 | Phase 1 |
| `/praxis proto <id>` | 查看原型详情 + 置信度历史 | Phase 2 |
| `/praxis proto <id> correct <描述>` | 纠正某个原型 | Phase 2 |
| `/praxis crystallize` | 查看待审批的固化提案 | Phase 3 |
| `/praxis crystallize approve` | 批准固化 | Phase 3 |
| `/praxis crystallize reject <原因>` | 拒绝固化 | Phase 3 |
| `/praxis architecture status` | 查看当前架构版本 | Phase 4 |
| `/praxis architecture freeze` | 紧急冻结 | Phase 4 |

---

## 五、Praxis 自身的"自主权边界"

V7 从工程角度定义 Praxis 可以"自主"做什么（不需要人类审批）：

```
✅ Praxis 可以自主做的事:

  【会话内】
  • 加载相关 ProtoStructure 到上下文
  • 在回复中使用 ProtoStructure 的内容（如"根据过去的观察，接下来可能应该..."）
  • 标记 SalientElement 候选（本地预标记）
  
  【session_end】
  • 将本会话的 SalientElement 持久化到 AgentMemory
  • 更新 ProtoStructure 置信度（基于预测标记协议）
  • 检测是否有新的共现模式
  
  【cron】
  • 运行模式检测（memory_patterns）
  • 检查退化信号
  • 生成架构审计报告
  
  【实时】
  • 调整参数（Level 1，变化幅度 < 20%）

⚠️ Praxis 可以做但需要通知用户的事:

  • 首次进入零先验场景 → 在回复中声明"这是我完全不了解的场景"
  • ProtoStructure 置信度跨过关键阈值（0.5, 0.8）→ 通知用户
  • 检测到退化 → 通知用户

❌ Praxis 不能自主做的事:

  • 将 ProtoStructure 固化为 CognitiveStructure（需要用户审批）
  • 删除或降级任何人工审核过的结构（需要用户或运维者审批）
  • 修改自己的系统提示模板（需要开发者改代码）
  • 修改 GovernancePolicy（需要运维者手动编辑）
```

---

## 兄弟文件

- [What is Praxis V7?](what-is.md) — V7 的工程定义
- [Why Praxis V7?](why.md) — 第一性原理工程可行性分析
- [How does it work?](how.md) — Hook 编排、Prompt 工程、数据流详解
- [When does it operate?](when.md) — 实现路线图与分阶段交付
- [Where does it sit?](where.md) — 工程架构与模块划分
- [Architecture Design](design.md) — 技术规格与 API 契约
