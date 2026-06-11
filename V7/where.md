# Where does Praxis V7 sit?

> V7 定义 Praxis 在 OpenClaw 插件系统中的工程位置：模块划分、Hook 回调映射、数据流向、文件结构。

---

## 一、Praxis 在 OpenClaw 中的位置

```
D:\WorkSpace\Praxis\openclaw\src\plugins\
├── hook-types.ts                    # OpenClaw Hook 定义（已有）
├── hook-message.types.ts            # message_received 事件类型（已有）
│
└── praxis-plugin/                  # ← Praxis V7 插件目录
    ├── index.ts                     # 插件入口，注册所有 Hook 处理器
    ├── config.ts                    # Praxis 配置（阈值、开关、AgentMemory 连接）
    │
    ├── hooks/                       # Hook 回调处理器
    │   ├── session-start.ts         # session_start: 加载结构、场景匹配、构造系统提示
    │   ├── message-received.ts      # message_received: 本地 SalientElement 预标记
    │   ├── before-tool-call.ts      # before_tool_call: 注入步骤级上下文
    │   ├── after-tool-call.ts       # after_tool_call: 记录工具使用模式
    │   ├── agent-end.ts             # agent_end: 置信度更新、预测验证
    │   └── session-end.ts           # session_end: 批量分析、ProtoStructure 更新、固化检查
    │
    ├── orchestration/               # 编排逻辑（Hook 之间共享）
    │   ├── context-builder.ts       # 构造注入 LLM 的上下文片段
    │   ├── scene-matcher.ts         # 场景匹配：消息 → CognitiveStructure/ProtoStructure
    │   ├── salience-marker.ts       # 本地 SalientElement 预标记（不需要 LLM）
    │   ├── confidence-updater.ts    # 置信度更新算法
    │   └── prediction-protocol.ts   # 预测标记协议（[PREDICTION_MATCHED/FAILED]）
    │
    ├── analysis/                    # 分析任务（session_end / cron 触发）
    │   ├── proto-constructor.ts     # ProtoStructure 构造（统计 + LLM）
    │   ├── pattern-detector.ts      # 共现模式检测（统计方法）
    │   ├── degradation-checker.ts   # 退化检测
    │   └── architecture-auditor.ts  # 架构审计（cron 触发）
    │
    ├── memory/                      # AgentMemory 集成层
    │   ├── client.ts                # AgentMemory MCP 客户端封装
    │   ├── schemas.ts               # Praxis 数据类型的 AgentMemory 存储格式
    │   ├── slots.ts                 # Slot 读写操作
    │   └── queries.ts               # 常用查询封装
    │
    ├── prompts/                     # Prompt 模板
    │   ├── system/                  # 系统提示注入片段
    │   │   ├── open-perception.md   # 开放感知指令
    │   │   ├── proto-structure.md   # ProtoStructure 上下文注入模板
    │   │   ├── role-awareness.md    # 角色感知注入
    │   │   └── prediction-markers.md # 预测标记协议说明（给 LLM 看的）
    │   ├── analysis/                # 分析 Prompt（给 LLM 执行认知分析任务）
    │   │   ├── construct-proto.md   # ProtoStructure 构造 prompt
    │   │   ├── detect-patterns.md   # 模式检测 prompt
    │   │   └── audit-architecture.md # 架构审计 prompt
    │   └── user/                    # 面向用户的回复模板
    │       ├── perception-summary.md # 感知摘要（"我对这个场景的观察..."）
    │       └── crystallization-proposal.md # 固化提案
    │
    ├── types/                       # TypeScript 类型定义
    │   ├── memory.ts                # SalientElement, ProtoStructure, etc.
    │   ├── scene.ts                 # SceneContext, SceneMatch
    │   └── hooks.ts                 # Hook 回调类型
    │
    └── tests/                       # 测试
        ├── salience-marker.test.ts
        ├── confidence-updater.test.ts
        ├── proto-constructor.test.ts
        └── integration/
            └── end-to-end.test.ts
```

---

## 二、数据流全景

```
                          ┌─────────────────────────┐
                          │     AgentMemory MCP       │
                          │                          │
                          │  Slots:                   │
                          │  • active_proto_structures│
                          │  • structure_registry     │
                          │  • governance_policy      │
                          │  • pending_crystallizations│
                          │  • architecture_version   │
                          │                          │
                          │  Memories (typed):        │
                          │  • salient_element        │
                          │  • proto_structure        │
                          │  • cognitive_structure    │
                          │  • structure_evolution    │
                          │  • architecture_proposal  │
                          │  • lesson                 │
                          └──────────┬───────────────┘
                                     │
                   ┌─────────────────┼─────────────────┐
                   │  读               │  写              │
                   ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│                    Praxis Plugin (V7)                        │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │session_start │  │   agent_    │  │session_end  │         │
│  │              │  │   loop      │  │             │         │
│  │ 1. 场景匹配   │  │             │  │ 1. 汇总本会话│         │
│  │ 2. 加载结构   │  │ message_    │  │ 2. LLM 分析  │         │
│  │ 3. 构造上下文 │  │ received    │  │ 3. 更新Proto │         │
│  │ 4. 注入prompt │  │ → 预标记     │  │ 4. 固化检查  │         │
│  └──────┬───────┘  │             │  └──────┬──────┘         │
│         │          │ agent_end    │         │                │
│         │          │ → 验证预测   │         │                │
│         │          │ → 更新置信度 │         │                │
│         │          └─────────────┘         │                │
│         │                                   │                │
│         ▼                                   ▼                │
│  ┌──────────────────────────────────────────────────┐       │
│  │              上下文编排层                          │       │
│  │  context-builder.ts: 将结构化数据 → prompt 片段     │       │
│  │  scene-matcher.ts: 消息 → 场景 → 结构              │       │
│  │  salience-marker.ts: 本地预标记                     │       │
│  │  confidence-updater.ts: 置信度算法                  │       │
│  └──────────────────────────────────────────────────┘       │
│                                                               │
│  ┌──────────────────────────────────────────────────┐       │
│  │              分析层 (session_end / cron)           │       │
│  │  proto-constructor.ts: 统计 + LLM → ProtoStructure │       │
│  │  pattern-detector.ts: 共现检测                     │       │
│  │  degradation-checker.ts: 退化监控                  │       │
│  └──────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、Hook 回调详细职责

### 3.1 session_start

```
session_start(sessionKey, context):
  
  1. 加载 Praxis 状态:
     ├─ memory_slot_get("active_proto_structures")
     ├─ memory_slot_get("structure_registry")
     └─ memory_slot_get("governance_policy")
  
  2. 场景匹配 (scene-matcher.ts):
     ├─ 检查 context 中的历史消息
     ├─ 遍历 structure_registry 中的 CognitiveStructure
     │   → 计算每个结构的适配度（语义相似度 / 关键词匹配 / 用户标记）
     ├─ 最佳匹配适配度:
     │   • > 0.7: 确定场景 → 加载对应的 ProcessTemplate + Role
     │   • 0.3-0.7: 模糊匹配 → 启用 V5 的 Structural Inadequacy Detector
     │   • < 0.3: 弱匹配 → 启用部分认知结构 + 警惕模式
     │   • = 0 (无匹配): 零先验场景 → 激活 Proto-Cognitive 模式
     └─ 遍历 active_proto_structures 中匹配当前场景的 ProtoStructure
  
  3. 上下文构造 (context-builder.ts):
     ├─ 将匹配的结构序列化为 prompt 片段
     ├─ 根据场景类型选择 prompt 模板:
     │   • 确定场景 → 注入 ProcessTemplate + Role 定义
     │   • 弱匹配 → 注入"警惕: 当前框架可能不适配"指令
     │   • 零先验 → 注入 open-perception.md 模板
     └─ 生成完整的系统提示补充片段
     返回: 附加到 Agent 系统提示的文本
```

### 3.2 message_received

```
message_received(event, context):
  
  ⚠️ 约束: 不能调用 LLM（延迟敏感）
  
  1. 本地 SalientElement 预标记 (salience-marker.ts):
     ├─ 关键词检测: "注意"、"关键是"、"你必须知道"、"第一步"、"先X再Y"
     ├─ 重复检测: 同一词/短语在近期消息中的出现次数
     ├─ 序列标记: "先...然后..."、"第一步...第二步..."
     ├─ 实体标记: 人名、角色名、地点名
     └─ 情绪标记: 用户表达了 frustration / urgency / confusion
  
  2. 追加候选元素到临时存储:
     └─ 写入 memory buffer（会话内，不持久化到 AgentMemory）
  
  返回: 不修改消息内容（透传）
```

### 3.3 before_tool_call

```
before_tool_call(toolName, params, context):
  
  1. 步骤级上下文注入:
     ├─ 当前场景的 ProcessTemplate 中有当前步骤的指导?
     │   → 注入步骤提示: "当前步骤: XX。预期: YY。注意: ZZ。"
     └─ 当前 ProtoStructure 置信度 > 0.5?
         → 注入原型提示: "根据观察，这一步通常意味着 XX（置信度 0.X）"
  
  2. 工具参数调整（可选）:
     └─ 基于历史经验优化工具调用的参数
  
  返回: 可选地修改 tool 参数或注入附加上下文
```

### 3.4 after_tool_call

```
after_tool_call(toolName, result, context):
  
  1. 记录工具使用模式:
     ├─ 记录: 工具调用序列 (哪个工具在哪个工具之后被调用)
     ├─ 记录: 工具调用结果 (成功/失败/耗时)
     └─ 记录: 异常模式 (重复调用同一工具 > 3 次 → 可能陷入循环)
  
  2. 更新临时统计:
     └─ 写入 memory buffer
  
  返回: 不修改结果（透传）
```

### 3.5 agent_end

```
agent_end(runId, result, context):
  
  1. 预测验证 (prediction-protocol.ts):
     ├─ 解析 Agent 输出中的预测标记:
     │   • [PREDICTION_MATCHED] → 预测正确
     │   • [PREDICTION_FAILED: 原因] → 预测错误
     │   • [PREDICTION_UNCERTAIN] → 无法判断
     ├─ 匹配到对应的 ProtoStructure
     └─ 更新置信度 (confidence-updater.ts):
         • 正确: new_conf = old_conf + 0.1 * (1 - old_conf)
         • 错误: new_conf = old_conf - 0.2 * old_conf
         • 不确定: 不变
  
  2. 提取 SalientElement（从 Agent 的交互中）:
     ├─ 解析用户反馈中的纠正信息
     │   → 用户纠正 = 高权重信号（直接调整置信度）
     ├─ 解析工具调用结果中的新实体/模式
     └─ 追加到 memory buffer
  
  3. 生成学习事件:
     └─ 如果有显著变化 → memory_lesson_save(type="proto_confidence_milestone")
  
  返回: 不修改结果（透传）
```

### 3.6 session_end

```
session_end(sessionKey, context):
  
  ⚠️ 这是 Praxis V7 中最重的 Hook 回调。用户可以接受这里的延迟（会话已结束）。
  
  1. 汇总本会话数据:
     ├─ 收集所有 memory buffer 中的候选 SalientElement
     ├─ 收集工具调用序列
     ├─ 收集预测验证结果
     └─ 收集用户反馈事件
  
  2. SalientElement 精化:
     ├─ 去重: 同一元素的不同标记合并
     ├─ 过滤: 显著性 < 阈值（至少 3 次重复或用户强调） → 丢弃
     ├─ 分类: 确定 element_type (entity/action/place/relation/attribute)
     └─ 持久化: memory_save(type="salient_element", data={...})
  
  3. ProtoStructure 更新:
     ├─ 检查当前场景的观察次数
     ├─ 如果观察次数 > 2:
     │   ├─ 调用 pattern-detector.ts（统计共现检测）
     │   ├─ 如果有显著模式 → 调用 proto-constructor.ts
     │   │   └─ 构造 LLM prompt → 调用 LLM → 解析为 ProtoStructure
     │   └─ 更新 active_proto_structures slot
     └─ 如果已有 ProtoStructure:
         ├─ 更新 ProtoStructure 的 observations 计数
         ├─ 更新 confidence_trend
         └─ 如果有新反例 → 追加到 contradictions
  
  4. 固化检查:
     ├─ 遍历所有 ProtoStructure
     ├─ 检查固化条件:
     │   • 核心置信度 > 0.8
     │   • 观察次数 >= 5
     │   • 最近 3 次无显著反例
     ├─ 条件满足 → 生成 CrystallizationProposal
     │   → 追加到 pending_crystallizations slot
     └─ 通知用户（下一条会话开始时）
  
  5. 学习事件持久化:
     └─ 如果有新的学习事件 → memory_lesson_save(...)
  
  6. 清理:
     └─ 清空 memory buffer
```

---

## 四、Cron 任务

### 4.1 每周模式审计（pattern_audit）

```
cron: "0 2 * * 0" (每周日凌晨 2 点)

流程:
  1. memory_patterns(type="salient_element")
     → 获取 AgentMemory 检测到的跨会话模式
  
  2. 对每个显著模式:
     ├─ 是否已有关联的 ProtoStructure? → 跳过
     └─ 没有关联 → 可能是遗漏的原型 → 生成 proto-constructor 任务
  
  3. 输出审计报告:
     → memory_save(type="audit_report", data={...})
```

### 4.2 每周退化检查（degradation_check）

```
cron: "0 3 * * 0" (每周日凌晨 3 点)

流程:
  1. 遍历所有 crystallized structures
  2. 检查近期使用情况:
     ├─ 预测准确率 < 0.7 → 标记 degraded
     └─ 累计反例 > 3 → 标记 degraded
  3. 退化结构:
     → 核心数据保留
     → 状态改为 "degraded"
     → 置信度降为 0.5
     → 移回 active_proto_structures
     → 通知用户
```

### 4.3 每月架构审计（architecture_audit）

```
cron: "0 4 1 * *" (每月 1 号凌晨 4 点)

流程:
  1. 收集 ArchitectureGap 信号:
     ├─ 跨场景的频繁适配度 < 0.3
     ├─ 结构放在"错误"的层中（跨 L3/L4 边界的知识）
     └─ 退化率 > 30% 的结构集合
  
  2. LLM 分析:
     → 调用 audit-architecture.md prompt
     → 生成 ArchitectureAuditReport
  
  3. 存入 AgentMemory:
     → memory_save(type="architecture_audit", data={...})
     → 通知运维者
```

---

## 五、数据存储策略

### Slot（快速读写，少量数据）

| Slot Key | 内容 | 大小约束 | 读写频率 |
|----------|------|---------|---------|
| `active_proto_structures` | 所有活跃的 ProtoStructure（JSON） | < 100KB | session_start 读, session_end 写 |
| `structure_registry` | 所有固化的 CognitiveStructure（JSON） | < 500KB | session_start 读, 固化时写 |
| `governance_policy` | 治理策略配置 | < 10KB | session_start 读, 运维者手动写 |
| `pending_crystallizations` | 待审批的固化提案 | < 50KB | session_end 追加, 审批时清理 |
| `architecture_version` | 当前架构版本号 | < 1KB | 架构变更时写 |
| `pending_questions` | 待向用户提问的问题 | < 20KB | session_end 追加, 提问后移除 |

### Memory（大容量，语义搜索）

| Type | 内容 | 搜索需求 |
|------|------|---------|
| `salient_element` | 单个 SalientElement | 按 scenario_id 查询, 按时间范围查询 |
| `proto_structure` | ProtoStructure 快照 | 按 scenario_id 查询, 按置信度过滤 |
| `cognitive_structure` | 固化结构版本 | 语义搜索: "适用于医院的流程" |
| `structure_evolution` | 结构演化记录 | 按时间范围查询 |
| `architecture_proposal` | 架构变更提案 | 按状态查询 |
| `lesson` | 学习事件 | 按类型/时间查询 |
| `audit_report` | 审计报告 | 按时间范围查询 |

---

## 兄弟文件

- [What is Praxis V7?](what-is.md) — V7 的工程定义
- [Why Praxis V7?](why.md) — 第一性原理工程可行性分析
- [Who is it for?](who.md) — 开发者、运维者、用户三角色
- [How does it work?](how.md) — Hook 编排、Prompt 工程、数据流详解
- [When does it operate?](when.md) — 实现路线图与分阶段交付
- [Architecture Design](design.md) — 技术规格与 API 契约
