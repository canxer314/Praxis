# Who is AgentOS V8 for?

> V8 的三角色模型与 V7 相同（开发者、运维者、用户），但职责边界因架构简化而移动。

---

## 一、角色三角（不变）

```
              ┌──────────┐
              │  用户     │
              │ (User)    │
              └─────┬─────┘
                    │ 使用 AgentOS 完成工作
                    │ 教 AgentOS 业务知识
                    │ 审核认知结构提案（可事后）
                    │ 纠正错误认知
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  开发者   │  │  运维者   │  │  AgentOS │
│(Developer)│  │(Operator) │  │  自身     │
└──────────┘  └──────────┘  └──────────┘
 删除更多代码   配置风险偏好   更多自主权
 而非编写      容忍自动推进   自动固化
```

---

## 二、开发者（Developer）

### V7 → V8 职责变化

| V7 职责 | V8 变化 | 原因 |
|---------|--------|------|
| 实现 regex 预标记 | ❌ **删除** | 不需要了 |
| 实现 PMI 统计预筛选 | ❌ **删除** | 不需要了 |
| 实现三种场景注入策略 | ❌ **删除** | 统一为一种 |
| 实现 selective scene-matcher | 🔄 **简化为场景识别** | 不再用于选择 |
| 实现 context-builder | 🔄 **替换为 context-organizer** | 从选择策略到组织策略 |
| — | ✅ **新增** statistical-verifier | 打破 LLM 验证闭环 |
| — | ✅ **新增** confidence-fuser | 多源信号融合 |
| — | ✅ **新增** local-cache | AgentMemory 降级 |
| — | ✅ **新增** transcript-analyzer | 端到端分析 |

**净变化：代码量减少约 30%，不是因为偷懒，而是因为 token 约束不再需要那些迂回。**

### 开发者的关键新设计决策

```
决策 1: 上下文组织策略（层级化 vs 扁平化）
  → 先实现扁平化（最简单），A/B 测试比较后决定是否引入层级化
  → 如果扁平化足够好，删除 context-organizer，架构进一步简化

决策 2: 统计验证的语义匹配方式
  方案 A: 简单字符串模糊匹配 (Levenshtein < 3)
  方案 B: Embedding 向量相似度 (cosine_sim > 0.7)
  推荐: 先 A 后 B。方案 A 实现成本极低，如果效果够用就不需要 B。
       方案 B 需要额外的 embedding API 调用，但仍是独立信号（非同一个 LLM）。

决策 3: 累积分析的历史会话数量
  N=3: 分析最近 3 次会话 → 延迟低，覆盖不足
  N=10: 分析最近 10 次 → 覆盖充足，延迟和成本高
  推荐: N=5 作为默认值，可在 config 中调整。
       首次构造 ProtoStructure 时 N=3（冷启动，快速迭代），
       置信度 > 0.6 后切换到 N=5（更全面的分析）。
```

---

## 三、运维者（Operator）

### 新增职责：风险偏好配置

V7 运维者主要做"审批"和"紧急干预"。V8 运维者新增一个关键职责：**配置 AgentOS 的自主权程度**。

```
GovernancePolicy 新增配置项:

auto_crystallization:
  enabled: true | false              # 是否允许自动固化
  tier_1:                            # 低风险自动固化
    min_confidence: 0.9
    min_observations: 10
    require_zero_corrections: true
  tier_2:                            # 高风险自动固化（跨场景一致时）
    min_confidence: 0.95
    min_observations: 20
    require_cross_scene_consistency: true
  max_auto_per_month: 3              # 安全阀：每月自动固化上限
  auto_rollback_enabled: true        # 自动固化的结构退化阈值更低（0.6 vs 0.7）

real_time_degradation:
  enabled: true
  single_session_accuracy_threshold: 0.3  # 单次会话准确率 < 30% → 立即怀疑退化

analysis_budget:
  max_history_sessions: 5            # 累积分析的最多历史会话数
  max_tokens_per_session: 20000      # 单次会话 transcript 截断长度
  llm_timeout_ms: 30000             # 分析 LLM 调用超时（从 15s 提高到 30s）
  max_monthly_analysis_cost: 100     # 每月分析 API 成本上限（美元）
```

### 运维者的审批权限（修订）

```
V7 vs V8 审批矩阵变化:

  变更级别        V7                   V8
  ─────────────────────────────────────────────────
  Level 1        AgentOS 自主          AgentOS 自主（不变）
  Level 2        用户审核             用户审核 / 自动（置信度 > 0.95）
  Level 3        运维者 + 用户        运维者 + 用户（不变）
  Level 4        运维者主导           运维者主导（不变）
  Level 5        运维者 + 外部专家     运维者 + 外部专家（不变）
  Level 6        人类手动             人类手动（不变）

新增: 自动固化回调
  运维者可以看到 "auto_crystallized" 的结构列表
  可以手动回滚任何自动固化的结构（一键操作）
  自动固化出错 → 运维者调整 GovernancePolicy 的阈值
```

---

## 四、用户（User）

### V7 → V8 交互模式变化

```
V7 的固化审批路径（必须用户主动操作）:
  ProtoStructure 达标 → notification → 用户看到 → 输入 /agentos crystallize approve
  → 用户不操作 = 永远停滞

V8 的固化审批路径（用户可选择被动）:
  ProtoStructure 置信度 > 0.8 → notification → 用户可 approve/reject/modify
  ProtoStructure 置信度 > 0.9 → 如果用户在过去 N 天从未纠正过此结构
    → auto_crystallize（标记 "auto"）
    → 通知用户: "我已将'门诊流程'固化为模板（置信度 0.92, 10次观察）。
       如果有误，随时可以说'门诊流程不对'来触发回滚。"
  → 用户不操作 = 自动推进（但留下快速回滚路径）
```

### 用户的新能力

```
V7 中没有的用户能力:

1. 一句话回滚固化结构:
   "这个门诊流程不对" → AgentOS 识别为纠正信号
   → 如果是 auto_crystallized → 立即回滚 + 置信度重置为 0.5
   → 如果是 人工审批的 → 标记 degradation_suspected

2. 查看 AgentOS 的"证据":
   /agentos evidence <proto_id>
   → 显示支撑该 ProtoStructure 的具体对话摘录
   → 用户可以逐条标记 "这条证据不对"

3. 设置个人偏好:
   "以后不要自动固化，都问我" → AgentOS 在 GovernancePolicy 中记录用户偏好
   "这个领域可以自动固化" → AgentOS 对该场景放宽阈值
```

---

## 五、AgentOS 自身的"自主权边界"（修订）

```
V7 中 AgentOS 不能做的事 → V8 中的变化:

❌ V7: 不能将 ProtoStructure 固化为 CognitiveStructure
✅ V8: 可以在置信度 > 0.9 + 零纠正的条件下自动固化（可事后回滚）

❌ V7: 不能删除或降级任何人工审核过的结构
  V8: 不变（人工审核过的结构仍需要人类审批才能降级）

❌ V7: 不能修改自己的系统提示模板
  V8: 不变（系统提示模板仍由开发者管理）

❌ V7: 不能修改 GovernancePolicy
  V8: 不变（仍由运维者手动编辑）

新增自主权:

✅ V8: 可以在 session_end 中实时检测退化信号（无需等待 cron）
✅ V8: 可以在 AgentMemory 不可用时降级到本地缓存
✅ V8: 可以基于统计信号（非 LLM 标记）独立判断预测成败
```

---

## 兄弟文件

- [What is AgentOS V8?](what-is.md) — V8 的工程定义
- [Why AgentOS V8?](why.md) — 第一性原理：为什么 1M 上下文改变了架构
- [How does it work?](how.md) — 层级化组织、统计验证、双信号融合
- [When does it operate?](when.md) — 简化的实现路线图
- [Where does it sit?](where.md) — 模块树（删除 + 新增 + 修改）
- [Architecture Design](design.md) — 技术规格与 API 契约
