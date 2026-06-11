# When does AgentOS V8 operate?

> V8 的实现路线图因架构简化而缩短。V7 需要 4 个 Phase（~4-5 个月），V8 可以压缩为 3 个 Phase（~3 个月），因为删除了大量 token 妥协模块。

---

## 一、实现路线图总览

```
Phase 1 (MVP)                Phase 2                      Phase 3
│                            │                            │
│ 累积 transcript + 扁平注入  │ 统计验证 + 层级化 + 自动固化│ 架构治理 + 持续优化
│                            │                            │
│ • 会话 transcript 存档      │ • statistical-verifier     │ • architecture-auditor
│ • session_end LLM 一步分析  │ • confidence-fuser         │   (对抗性 prompt)
│ • flat 全量注入             │ • context-organizer        │ • local-cache 降级
│ • 基础 ProtoStructure 构造  │   (A/B test vs flat)       │ • 成本优化
│ • 手动固化审批              │ • auto-crystallization     │ • 注意力预算调优
│ • real-time degradation     │ • degradation deep check   │
│                            │                            │
│ 目标: 验证端到端 transcript │ 目标: 引入独立验证 +       │ 目标: 长期稳定运行
│ → 结构 的链路               │ 自动推进                    │
│                            │                            │
├─────── 3-4 周 ─────────────┼──────── 4-5 周 ───────────┼──────── 3-4 周 ──────┤
│                            │                            │
▼                            ▼                            ▼
总计: 约 3 个月到完整功能
(vs V7 的 4-5 个月 — 删除的模块不再需要实现和测试)
```

---

## 二、Phase 1: Transcript 驱动的基础认知（3-4 周）

### 目标
验证完整 transcript → LLM 直接提取 → ProtoStructure 的端到端链路。这是 V8 相对 V7 缩短最多的地方——Phase 1 跳过 regex 预标记和 PMI 预筛选，直接验证 LLM 从完整对话中提取认知元素的能力。

### 交付物

| 模块 | 内容 | 优先级 | V7 对比 |
|------|------|--------|---------|
| **Transcript 存档** | `hooks/message-received.ts` — 归档原始消息到 buffer | P0 | 🟢 **大幅简化**（V7 的 salience-marker 删除） |
| **Transcript 持久化** | `memory_save(type="session_transcript")` | P0 | 🆕 新增 |
| **Cumulative Analyzer** | `transcript-analyzer.ts` — LLM 一步完成提取+构造 | P0 | 🟢 **合并** V7 的 proto-constructor + pattern-detector |
| **Flat Context Organizer** | `context-organizer.ts` — 扁平化全量注入（Phase 1 先用最简单的扁平方案） | P0 | 🔄 替代 V7 的 context-builder + scene-matcher |
| **Prediction Protocol** | `prediction-protocol.ts` — 同 V7 | P0 | 无变化 |
| **手动固化审批** | `/agentos crystallize` 命令 | P1 | 无变化 |
| **Real-time Degradation** | `degradation-checker.ts` — session_end 内联检测 | P1 | 🟢 **增强**（V7 需要等到 Phase 3 才做 cron） |

### Phase 1 明确不做

- ❌ 不实现统计验证器（Phase 2）
- ❌ 不实现层级化组织（先用扁平注入。Phase 2 做 A/B 测试）
- ❌ 不实现自动固化（Phase 2）
- ❌ 不实现 local-cache 降级（Phase 3）
- ❌ 不实现对抗性架构审计（Phase 3）

### Phase 1 验证标准

```
✅ LLM 从完整 transcript 中提取的 SalientElement 准确率 > 60%
   (人工 review 20 个 element — 对比 V7 的 regex 预标记在同等数据上的表现)
✅ session_end LLM 分析延迟 < 30s (累积 3 次会话 transcript)
✅ session_start 扁平全量注入的额外延迟 < 2s (AgentMemory 读取 + 序列化)
✅ ProtoStructure 构造质量 ≥ V7 在同等条件下的质量
   (用 V7 的 PMI+LLM 两步法作为 baseline)
```

### Phase 1 关键实验

| 实验 | 方法 | 决策标准 |
|------|------|---------|
| **Transcript 提取 vs Regex** | 同一批数据，regex 预标记 vs LLM 从 transcript 提取 → 比较 precision/recall | LLM 提取显著优于 regex → 确认删除 salience-marker |
| **累积分析延迟** | 测量 N=1/3/5 次历史会话的 LLM 分析延迟 | 找到延迟 < 30s 的最大 N 值 → 设为默认 |
| **扁平全量注入质量** | A/B 测试：开启 AgentOS vs 关闭 → 比较 Agent 回复质量 | 开启后质量不下降 → 确认全量注入安全 |

---

## 三、Phase 2: 独立验证 + 自动推进（4-5 周）

### 目标
引入统计验证器打破 LLM 自引用闭环，引入自动固化减少人类依赖。同时实验验证层级化 vs 扁平化。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **Statistical Verifier** | `statistical-verifier.ts` — 工具序列 vs ProtoSequence 比对 | P0 |
| **Confidence Fuser** | `confidence-fuser.ts` — 统计 + LLM + 用户三源融合 | P0 |
| **Context Organizer (层级化)** | `context-organizer.ts` 增加层级化模式 | P0 |
| **A/B 测试框架** | 扁平化 vs 层级化的对比测试 | P0 |
| **Auto Crystallization** | 自动固化阶梯（tier 1 + tier 2） | P1 |
| **Degradation Deep Check** | 每周 cron（保留 V7 的深度检测） | P1 |
| **Governance Policy UI** | `/agentos config` — 运维者配置风险偏好 | P1 |

### Phase 2 关键实验

| 实验 | 方法 | 决策标准 |
|------|------|---------|
| **统计验证 vs LLM 标记** | 50 次会话 → 比较统计验证结果与 LLM 标记结果的一致率 | 一致率 < 70% → 统计验证器有价值（两者经常不一致）; 一致率 > 85% → 降低统计验证权重 |
| **层级化 vs 扁平化** | 同一批 ProtoStructure，两种组织方式 → 测量 LLM 在后续对话中使用这些结构的频率和准确性 | 层级化显著优于扁平化 → 采用层级化; 无显著差异 → 删除层级化，保持扁平 |
| **自动固化错误率** | 模拟 20 个 ProtoStructure 的置信度路径 → 检查自动固化决策是否合理 | 错误率 < 10% → 保持自动固化; > 20% → 收紧阈值 |
| **双信号融合效果** | 对比单一 LLM 信号 vs 双信号融合的置信度收敛曲线 | 双信号更稳（更少振荡）→ 确认融合策略 |

### Phase 2 验证标准

```
✅ 统计验证器与 LLM 标记的一致率记录在案（不预设目标，先看数据）
✅ 层级化 vs 扁平化的实验结果 → 决定是否永久保留 context-organizer
✅ 自动固化的错误率 < 15%（用户回滚比例 < 15%）
✅ 实时退化检测的误报 < 20%（标记 suspected 但用户确认没问题 < 20%）
```

---

## 四、Phase 3: 架构治理 + 持续优化（3-4 周）

### 目标
实现对抗性架构审计、AgentMemory 降级缓存、注意力预算调优、成本优化。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **Adversarial Audit** | `architecture-auditor.ts` — 对抗性 prompt 交叉验证 | P0 |
| **Local Cache** | `local-cache.ts` — AgentMemory 降级 | P0 |
| **成本监控** | session_end 分析的成本追踪 + `max_monthly_analysis_cost` 限制 | P1 |
| **注意力预算调优** | 基于 Phase 2 实验数据优化层级化组织的参数 | P1 |
| **运维者仪表盘** | `/agentos architecture status/proposals/rollback` | P1 |

### Phase 3 验证标准

```
✅ 对抗性审计报告的误报率 < 30%（提出但实际不存在的架构问题）
✅ AgentMemory 不可用时 local-cache 无缝接管（session_start 不报错）
✅ 月度分析成本 < config.max_monthly_analysis_cost
✅ 端到端测试: 5 个零先验场景的完整认知生命周期（同 V7 Phase 3）
```

---

## 五、V7 vs V8 路线图对比

| 维度 | V7 | V8 | 差异原因 |
|------|----|----|---------|
| 总 Phase 数 | 4 | 3 | Phase 1+2 合并（删除 regex/PMI 节省一个 phase） |
| 总时长 | 4-5 个月 | 3 个月 | 删除约 5 个模块的实现和测试时间 |
| Phase 1 内容 | regex + salience + 场景匹配 | transcript 存档 + LLM 一步分析 | Token 约束解除 → 跳过有损压缩步骤 |
| 首次 LLM 分析时机 | Phase 2 | Phase 1 | 不需要等 regex 质量验证 → 直接验证 LLM 分析 |
| 退化检测 | Phase 3 (cron) | Phase 1 (实时) + Phase 2 (cron) | 实时检测实现成本低 → 提前 |
| 自动固化 | 不存在 | Phase 2 | 人类依赖问题 → 需要自动降级路径 |
| 统计验证 | 不存在 | Phase 2 | V8 核心创新 |

---

## 六、测试策略

### V8 新增的测试

| 测试目标 | 方法 | 覆盖要求 |
|---------|------|---------|
| statistical-verifier | 20 组人工标记的工具序列 + ProtoSequence | 序列对齐准确率 > 90%（人工标注 baseline） |
| confidence-fuser | 10 组 (统计信号, LLM标记, 用户纠正) 组合 | 融合逻辑 100% 符合 spec |
| context-organizer (flat) | 50 个 ProtoStructure → 序列化 → 验证 token 数 | 预估偏差 < 20% |
| context-organizer (hierarchical) | 同上 + 验证层级结构完整性 | 三层均非空 |
| transcript-analyzer | 同 V7 的 proto-constructor 测试 | 质量 ≥ V7 baseline |
| local-cache | AgentMemory 模拟故障 → 验证降级 + 恢复同步 | 无数据丢失 |

### V7 中可删除的测试

```
- salience-marker.test.ts         → 删除（模块不存在）
- pattern-detector.test.ts        → 删除（模块不存在）
- scene-matcher.test.ts           → 删除（功能简化，不需要独立测试）
```

---

## 兄弟文件

- [What is AgentOS V8?](what-is.md) — V8 的工程定义
- [Why AgentOS V8?](why.md) — 第一性原理：为什么 1M 上下文改变了架构
- [Who is it for?](who.md) — 角色职责的变化
- [How does it work?](how.md) — 层级化组织、统计验证、双信号融合
- [Where does it sit?](where.md) — 模块树（删除 + 新增 + 修改）
- [Architecture Design](design.md) — 技术规格与 API 契约
