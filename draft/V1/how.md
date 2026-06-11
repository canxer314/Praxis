# How does Praxis work?

## 总览：六层架构

Praxis 采用"具身认知"的工程实现——从身体（工具层）到自我认知（自主层），逐层向上构建：

```
┌──────────────────────────────────────────────────────────────┐
│                 AI 通用行动代理操作系统 (Praxis)              │
│                                                               │
│  Layer 6: 自主决策层 (Autonomy)                               │
│  • 跨工具的自主性判断                                        │
│  • 新工具的主动探索                                          │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Layer 5: 能力模型层 (Competency Model)                │    │
│  │ • 多维度技能树（领域 × 工具 × 熟练度）                │    │
│  │ • 跨工具技能组合                                      │    │
│  │ • 每个工具/技能的独立成长曲线                          │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Layer 4: 学习闭环层 (Learning Loop)                   │    │
│  │ • 统一的 执行→评估→差距→更新→固化 循环               │    │
│  │ • 每个工具的反馈解释器                                │    │
│  │ • 跨会话的经验传递                                    │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Layer 3: 知识管理层 (Knowledge Management)            │    │
│  │ • 多模态知识摄入（文字/语音/图像/视频）               │    │
│  │ • 工具特定知识库                                      │    │
│  │ • 知识→工具→技能的关联索引                            │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Layer 2: 任务编排层 (Task Orchestration)              │    │
│  │ • 任务分解：复杂任务→子任务→工具调用序列              │    │
│  │ • 跨工具工作流                                        │    │
│  │ • 错误恢复和容错策略                                  │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Layer 1: 工具与集成层 (Tool & Integration)            │    │
│  │ • 工具注册、发现、描述                                │    │
│  │ • 每个工具的熟练度追踪                                │    │
│  │ • 工具反馈解释器                                      │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Layer 1: 工具与集成 —— AI 的"身体"

这是最底层。没有这一层，AI 只能思考和说话，不能行动。

### 工具注册

每个工具接入 Praxis 时，必须提供：
- **接口定义**：可用的 actions、参数、返回值、异步事件
- **反馈信号**：如何判断成功/失败？有哪些质量指标？
- **风险评估**：操作是否有物理后果？最大自主级别？

示例（咖啡机）：
```yaml
tool:
  id: "coffee_machine"
  type: "physical_control"
  interface:
    actions: [brew, status, stop]
    events: [brew_complete, out_of_beans, error]
  feedback:
    success: [brew_complete, user_affirms_taste]
    failure: [error, out_of_beans, user_complains]
  risk:
    physical_consequences: [waste_beans, water_spill]
    max_autonomy: "supervised"
```

### 工具熟练度追踪

每个工具有独立的熟练度曲线：
- **proficiency**：0.0–1.0 的量化评分
- **level**：novice → advanced_beginner → competent → proficient → expert
- **evidence**：证明当前水平的具体任务列表
- **known_failure_modes**：从错误中学到的防范策略
- **user_preferences**：用户对该工具使用的特定偏好
- **learning_history**：按时间排列的学习事件

## Layer 2: 任务编排 —— AI 的"行动"

### 任务生命周期

```
分配 → 理解 → 分解 → 执行（调用工具）→ 交付 → 评估 → 提取教训
```

### 任务类型

| 类型 | 说明 | 示例 |
|------|------|------|
| implementation | 实现某个功能 | 写代码、做 PPT |
| analysis | 分析某个问题 | 代码审查、数据洞察 |
| learning | 显式学习任务 | 看教程视频、阅读文档 |
| operation | 操作物理设备 | 冲咖啡、开空调 |
| perception | 感知/监听 | 旁听会议、监控日志 |

### 跨工具工作流

复杂任务可能涉及多个工具协作。Praxis 追踪每个步骤的完成情况，定位瓶颈（"周报流程中 Excel 是瓶颈"）。

## Layer 3: 知识管理 —— AI 的"记忆"

### 知识来源（多模态）

| 模态 | 摄入方式 | 存储 | 检索 |
|------|---------|------|------|
| 文字 | 直接存储 | Markdown | BM25 + 向量 |
| 语音 | 转写 + 说话人标注 | 带时间戳转写 | 文本检索 + 时间定位 |
| 图片 | 视觉描述 + OCR | 描述 + 元数据 | 文本检索 + 视觉特征 |
| 视频 | 关键帧 + 转写 + 描述 | 多段带时间戳内容 | 文本检索 + 关键帧 |

### 知识组织

- **domain**：知识领域（authentication, coffee-brewing, presentation-design）
- **skill_associations**：关联的技能条目
- **tool**：关联的工具
- **difficulty_level**：难度分级
- **application_count**：被应用了多少次（强化信号）

## Layer 4: 学习闭环 —— AI 的"成长"

这是系统的心脏。所有的成长都通过这个闭环：

```
执行任务 → 评估结果 → 识别能力差距 → 更新能力模型 → 调整行为 → 应用到下次任务
```

### 学习事件

每次有意义的成长都被记录为一个 LearningEvent：

```yaml
learning_event:
  source_task: "task-023"
  type: "mistake_correction"  # 或 skill_improvement, new_knowledge, feedback_integration, insight
  before: "忘记检查水量就开始冲泡"
  after: "冲泡前自动检查 status()"
  root_cause: "对咖啡机状态检查不够重视"
  affected_skills:
    - skill: "coffee-brewing"
      change: "+0.1 proficiency"
  prevention_strategy: "每次 brew() 前先调用 status()"
```

### 反馈解释器

不同工具有不同的成功/失败信号。Praxis 为每个工具定义反馈→学习的映射：
- 代码工具：编译错误 → 语法学习，运行时错误 → 逻辑学习
- 邮件工具：无回复 → 时机或内容学习，被标记垃圾 → 格式学习
- 咖啡机：用户抱怨太淡 → 研磨度/水温学习

## Layer 5: 能力模型 —— AI 的"自我认知"

### 统一技能结构

不论编程、做咖啡还是写 PPT，所有技能共享相同结构：

```yaml
skill:
  id: "skill:coffee-brewing"
  domain: "physical_control"
  tool: "coffee_machine"
  proficiency: 0.65
  level: "competent"
  evidence: [task-023, task-024, task-028]  # 证据驱动的评估
  best_practices: ["冲前检查水量和豆量"]
  anti_patterns: ["不要在豆子不足时开始"]
  user_preferences: {strength: "strong", temperature: 85}
  autonomy_level: "semi_autonomous"
  learning_timeline: [...]  # 完整的成长时间线
```

### 多个技能 = 能力模型

AI 的"自我"就是它所有技能的集合 + 它们之间的关联 + 跨工具的组合技能。

## Layer 6: 自主决策 —— AI 的"判断"

### 自主性判断逻辑

```
当 AI 准备执行一个操作时：
  1. 查该工具的 proficiency
  2. 查该操作类型的风险等级
  3. 决定：
     - 熟练 + 低风险 → 自主执行
     - 熟练 + 高风险 → 执行但告知用户
     - 不熟练 + 低风险 → 确认后执行
     - 不熟练 + 高风险 → 必须确认
     - 发生过错误 → 保守处理（降一级自主性）
```

### 自我驱动学习

AI 主动识别能力缺口：
- "我在 security-patterns 上只有 0.55，而且已经两周没进步了"
- 生成学习请求："能否给我分配一个涉及 OAuth 集成的任务来练习？"

## 兄弟文件

- [What is Praxis?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 谁在使用？谁是那个"自己"？
- [Why does it exist?](why.md) — 它为什么存在
- [When does it operate?](when.md) — 生命周期和触发点
- [Where does it sit?](where.md) — 架构定位与系统关系
- [Architecture Design](design.md) — V1 架构设计文档
