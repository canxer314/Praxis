# When does AgentOS V5 operate?

## V5 触发模型：V4 全部保留 + 结构进化生命周期

V4 的触发模型完全保留。V5 新增"结构进化"生命周期——这不是由某个 Hook 触发的，而是在多个 Hook 的累积数据达到阈值后自动启动。

```
触发类型              触发点                              V4    V5
──────────────────────────────────────────────────────────────
Hook (事件)           session_start                       ✅    ✅
Hook (事件)           message_received                    ✅    ✅
Hook (事件)           before/after_tool_call              ✅    ✅
Hook (事件)           agent_end                           ✅    ✅（扩展）
Hook (事件)           session_end                         ✅    ✅（扩展）
定时 (时间)            cron_tick                           ✅    ✅
过程 (过程)            步骤入口/出口/超时                  ✅    ✅
主动 (主动)            Curiosity Engine 扫描               ✅    ✅
──────────────────────────────────────────────────────────────
Meta (V5 新增)         StructuralGap 置信度 > 阈值         ❌    ✅ 新增
Meta (V5 新增)         Constructor 生成候选 → 等待人类     ❌    ✅ 新增
Meta (V5 新增)         人类批准 → 进入实验                 ❌    ✅ 新增
Meta (V5 新增)         实验数据达标 → 固化提议             ❌    ✅ 新增
Meta (V5 新增)         实验失败 → 回滚/废弃               ❌    ✅ 新增
Meta (V5 新增)         定期结构审计 (每周 cron)             ❌    ✅ 新增
```

---

## 结构进化完整生命周期

```
┌────────────────────────────────────────────────────────────┐
│            Structure Evolution Lifecycle                     │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Phase 1: 检测 (Detection)                            │   │
│  │                                                       │   │
│  │ 触发: agent_end + session_end（每次）                 │   │
│  │                                                       │   │
│  │ Structural Inadequacy Detector 运行:                   │   │
│  │   ├─ 收集本轮所有 V4 子系统的适配质量数据              │   │
│  │   ├─ 与历史数据合并（跨会话聚合）                      │   │
│  │   ├─ 聚类相似场景的失败模式                            │   │
│  │   ├─ 计算每个场景的 StructuralGap 置信度               │   │
│  │   └─ 更新 StructuralGap 注册表                         │   │
│  │                                                       │   │
│  │ 如果置信度 > 0.7 且 Gap 是新的或恶化的:                 │   │
│  │   → 进入 Phase 2                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Phase 2: 构造 (Construction)                         │   │
│  │                                                       │   │
│  │ 触发: StructuralGap 置信度 > 0.7                      │   │
│  │ 执行: session_end 或 cron（非实时，不阻塞用户）       │   │
│  │                                                       │   │
│  │ Cognitive Structure Constructor 运行:                  │   │
│  │   ├─ Step 1: 归纳根因（为什么现有框架不够）           │   │
│  │   ├─ Step 2: 生成候选结构（1-3 个候选方案）           │   │
│  │   ├─ Step 3: 设计验证计划                              │   │
│  │   └─ Step 4: 生成 Proposal 文档                        │   │
│  │                                                       │   │
│  │ → 存储为 CandidateStructure                           │   │
│  │ → 在下次用户活跃时呈交（不在用户忙时打断）            │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Phase 3: 审核 (Review)  ← 人类在回路中              │   │
│  │                                                       │   │
│  │ 触发: 用户在活跃会话中收到 Proposal                   │   │
│  │                                                       │   │
│  │ AgentOS 呈交:                                          │   │
│  │   "我注意到 [场景类型] 我一直处理不好。               │   │
│  │    这是我的分析：[根因]。                              │   │
│  │    我设计了一种新的处理方式：[候选结构概要]。          │   │
│  │    这是验证计划：[范围+指标+回滚条件]。                │   │
│  │                                                       │   │
│  │    要试试吗？ / 调整后再看 / 不了"                     │   │
│  │                                                       │   │
│  │ 用户决策:                                              │   │
│  │   ✅ 批准 → 进入 Phase 4                              │   │
│  │   🔄 修改 → Constructor 修改后重新呈交                │   │
│  │   ❌ 拒绝 → 记录 rejected, 冷却期 30 天               │   │
│  │   ⏸️ 搁置 → 保留 proposal, 用户随时可重新激活         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Phase 4: 实验 (Experiment)                           │   │
│  │                                                       │   │
│  │ 触发: 用户批准                                        │   │
│  │ 范围: 仅限目标场景类型                                │   │
│  │                                                       │   │
│  │ 每次目标场景触发时:                                    │   │
│  │   ├─ 激活新结构（Experimental）                       │   │
│  │   ├─ 执行中收集效果数据                               │   │
│  │   ├─ agent_end: Action Verification 对比新旧结构      │   │
│  │   └─ 如触发 rollback_condition → 立即暂停+通知用户   │   │
│  │                                                       │   │
│  │ 实验次数达到 min_trials 后:                            │   │
│  │   → 评估是否满足 success_criteria                     │   │
│  │   → 满足 → 进入 Phase 5                               │   │
│  │   → 不满足 → 分析原因 → 修改重试 或 废弃             │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Phase 5: 固化 / 放弃 (Crystallize / Abandon)        │   │
│  │                                                       │   │
│  │ 固化:                                                 │   │
│  │   → 状态: experimental → crystallized                │   │
│  │   → 版本: v1.0                                       │   │
│  │   → 激活范围: 目标场景全局                            │   │
│  │   → 通知用户: "NegotiationModel 已固化"              │   │
│  │   → 持续监控退化                                      │   │
│  │                                                       │   │
│  │ 放弃:                                                 │   │
│  │   → 状态: experimental → rejected                    │   │
│  │   → 保留分析记录（下次不重复同样的错误假设）          │   │
│  │   → 通知用户: "NegotiationModel 验证失败，已停用"    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 持续监控: 退化检测 (Regression Detection)            │   │
│  │                                                       │   │
│  │ 触发: 每次 agent_end（所有场景）                      │   │
│  │                                                       │   │
│  │ 固化后的结构持续与 baseline 比较:                      │   │
│  │   ├─ 目标场景: 效果是否保持 ≥ 固化时？                │   │
│  │   └─ 非目标场景: 效果是否退化？（新结构不应影响）     │   │
│  │                                                       │   │
│  │ 如果检测到退化:                                        │   │
│  │   → 通知用户 + 建议回滚 或 修补                       │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

---

## agent_end 和 session_end 的 V5 扩展

### agent_end（V5 扩展）

```
[Hook: agent_end] ← V5 扩展

V4 原有:
  ├─ 工具级学习
  ├─ 任务级反思
  ├─ Curiosity Engine 扫描
  └─ 当前步骤状态更新 + Action Verification

V5 新增:
  ├─ Meta Layer: Structural Inadequacy Detector 运行
  │   ├─ 收集本轮适配质量数据
  │   ├─ 更新 StructuralGap 置信度
  │   └─ 如果某 Gap 置信度 > 0.7 → 触发 Constructor
  │
  └─ Meta Layer: 实验中的结构
      ├─ 收集本轮效果数据
      ├─ 对比 success_criteria
      └─ 检查 rollback_condition
```

### session_end（V5 扩展）

```
[Hook: session_end] ← V5 扩展

V4 原有:
  ├─ 流程状态快照
  ├─ 流程效率对比
  ├─ Momentum 效果总结
  └─ Curiosity 缺口审计

V5 新增:
  ├─ Meta Layer: 结构健康报告
  │   ├─ 所有 Crystallized Structure 的近期适配质量
  │   ├─ 所有 Experimental Structure 的实验进度
  │   └─ 所有 StructuralGap 的置信度变化趋势
  │
  └─ Meta Layer: 如果有未呈交的 CandidateStructure
      → 评估是否在下次用户活跃时呈交
```

---

## 定期审计 cron

```
每周 cron: Structure Audit

1. 审查所有 StructuralGap:
   • 哪些 gap 置信度在上升？（问题在恶化）
   • 哪些 gap 长期低置信度？（可能不是真正的结构缺口 → 降级）

2. 审查 Experimental Structures:
   • 实验是否在推进？（有足够的触发次数？）
   • 如果 30 天无触发 → 提醒用户（"这个实验场景从未再出现"）

3. 审查 Crystallized Structures:
   • 是否存在退化？
   • 是否有结构之间的冲突？（两个结构对同一场景给出了矛盾的指导）

4. 生成 Structure Audit Report → 向用户提供摘要
```

---

## 用户命令（V5 新增）

| 命令 | 功能 |
|------|------|
| `/agentos structures` | 查看认知结构注册表（所有结构 + 状态 + 版本） |
| `/agentos structure <id>` | 查看某个结构的详细信息 |
| `/agentos structure <id> approve` | 批准候选结构进入实验 |
| `/agentos structure <id> reject` | 拒绝候选结构 |
| `/agentos structure <id> rollback` | 回滚固化结构到上一版本 |
| `/agentos gaps structural` | 查看已识别的结构缺口 |
| `/agentos experiments` | 查看进行中的结构实验 |
| `/agentos governance` | 查看/修改治理策略 |

---

## 兄弟文件

- [What is AgentOS V5?](what-is.md) — 它是什么
- [Who is it for?](who.md) — 人类角色的转变
- [Why AgentOS V5?](why.md) — 为什么需要 Meta Layer
- [How does it work?](how.md) — Meta Layer 三个子系统详解
- [Where does it sit?](where.md) — Meta Layer 的位置
- [Architecture Design](design.md) — V5 架构设计文档
