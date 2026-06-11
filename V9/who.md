# Who is AgentOS V9 for?

> V9 三角色模型与 V8 相同。变化在于开发者需实现新的核心模块，运维者获得压力阈值配置和自适应参数锁定能力。

---

## 一、角色三角（不变）

```
              ┌──────────┐
              │  用户     │
              │ (User)    │
              └─────┬─────┘
                    │ 使用 AgentOS 时:
                    │  • 长会话中 AgentOS 不会突然"失忆"
                    │  • Critical 压力时可主动说"查一下门诊流程"
                    │  • 收到一致性矛盾的通知
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  开发者   │  │  运维者   │  │  AgentOS │
│(Developer)│  │(Operator) │  │  自身     │
└──────────┘  └──────────┘  └──────────┘
 实现压力监测   配置压力阈值   根据压力自适应
 实现遥测+验证  锁定自适应参数 主动压缩注入
 实现按需检索   监控利用率    按需提供结构
```

---

## 二、开发者（Developer）

### V8 → V9 职责变化

| 职责 | V8 | V9 |
|------|----|----|
| 注入策略 | 实现全量注入 (context-organizer) | **新增强**: 实现四级压缩注入 |
| 上下文管理 | 无 | **新增**: 实现 context-pressure-monitor |
| 结构访问 | 全部推送 | **新增**: 实现 recall_structure tool |
| 注意力 | 无测量 | **新增**: 实现 attention-telemetry |
| 验证 | 仅 ProtoSequence | **扩展**: ProtoRole + ProtoConcept + ProtoPurpose 验证器 |
| 工具映射 | fuzzyMatchScore | **增强**: LLM 预标注映射 + embedding fallback |
| 配置 | 46 个固定参数 | **新增**: config-adapter 自适应调优 |
| 一致性 | 无 | **新增**: consistency-checker 跨结构矛盾扫描 |

### 开发者的关键新决策

```
决策 1: 压力估算精度 vs 开销
  → 方案 A: 每次 session_start 精确 tokenize (精度高, +50ms)
  → 方案 B: 基于字符数估算 (精度 ±15%, < 1ms)
  → 推荐: 方案 B 用于实时判断 + 方案 A 用于遥测记录

决策 2: recall_structure 的检索方式
  → 方案 A: 关键字匹配 (快, 精确度低)
  → 方案 B: embedding 语义匹配 (慢, 精确度高)
  → 推荐: A 为主, B 为 fallback (关键字没结果时用 embedding)

决策 3: 压缩策略 — 什么可以安全压缩
  → ProtoSequence 置信度历史 → 可压缩 (保留当前置信度 + 最近 3 次)
  → ProtoSequence 变体列表 → 可压缩 (保留 top 2 变体)
  → ProtoRole 行为详情 → 可压缩 (保留行为列表, 去掉每个行为的置信度)
  → ProtoConcept 特征详情 → 可压缩 (保留特征列表)
  → 反例/矛盾 → 不压缩 (关键质量信号)
```

---

## 三、运维者（Operator）

### 新增职责

| 职责 | 说明 |
|------|------|
| **压力阈值配置** | 配置四个压力等级的切换阈值 (默认 60%/75%/90%) |
| **压缩策略选择** | 选择激进压缩 vs 保守压缩 (影响压缩后的 token 量) |
| **自适应参数锁定** | 对不想自动调整的参数加锁 (如 crystallization threshold) |
| **利用率监控** | 关注 attention-telemetry 报告 — 哪些结构是"僵尸结构" |

### GovernancePolicy 新增配置

```yaml
context_pressure:
  levels:
    normal_threshold: 0.60      # < 60% → Normal
    elevated_threshold: 0.75    # 60-75% → Elevated
    high_threshold: 0.90        # 75-90% → High
    # > 90% → Critical
  compression_strategy: 'balanced'  # 'aggressive' | 'balanced' | 'conservative'
  token_estimation_mode: 'chars'    # 'chars' (fast) | 'tokenize' (precise)
  safety_margin: 0.10              # 10% 安全裕度

lazy_loading:
  enabled: true
  max_results_per_recall: 3
  embedding_fallback: true

attention_telemetry:
  enabled: true
  structure_used_marker: '[STRUCTURE_USED: <proto_id>]'
  zombie_threshold: 0.1           # 采用率 < 10% → 标记为僵尸结构
  report_frequency: 'weekly'

adaptive_config:
  enabled: true
  adjustment_range: 0.20           # ±20% 调整范围
  locked_params: []                # 锁定的参数列表 (不自动调整)
  calibration_min_samples: 20      # 至少 20 个样本才校准
```

### 运维者审批矩阵（与 V8 相同，无变化）

运维者的审批权限在 V9 中没有变化。V9 不改变 AgentOS 的自主权边界。

---

## 四、用户（User）

### V9 新增的交互

```
1. 用户感知到上下文压力:
   当 AgentOS 进入 High/Critical 模式时，在系统提示中
   注入一个简短的状态信号给 LLM:

   "⚠️ 当前上下文使用率 87% (High)。AgentOS 已压缩认知结构的注入。
    如需完整详情，你可以说 '查一下[结构名]' 来获取。"

   → LLM 在回复中不会主动提这个（除非用户问）
   → 但 LLM 知道可以用 recall_structure 获取更多细节

2. 用户主动检索结构:
   "AgentOS，门诊流程的完整步骤是什么？"
   → LLM 调用 recall_structure("门诊流程")
   → 获取完整 ProtoSequence 详情
   → 在回复中展示

3. 收到一致性警报:
   AgentOS 检测到同一场景的两个结构矛盾:
   → 在 session_start 的待验证问题中提醒
   → "我注意到'门诊标准流程'和'急诊快速通道'对'挂号'步骤的描述矛盾。
      你能帮我确认哪种理解是对的？"
```

---

## 五、AgentOS 自身的"自主权边界"（与 V8 相同）

V9 不改变 AgentOS 的自主权边界。压力感知属于编排逻辑的增强，不影响"什么可以自主做 vs 什么需要人类审批"的边界。

---

## 兄弟文件

- [What is AgentOS V9?](what-is.md) — V9 的工程定义
- [Why AgentOS V9?](why.md) — 第一性原理：为什么 token 爆炸需要压力感知
- [How does it work?](how.md) — 压力监测器、四级压缩、按需检索等
- [When does it operate?](when.md) — 4 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V8 基础 + 7 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
