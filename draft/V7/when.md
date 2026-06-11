# When does Praxis V7 operate?

> V7 定义了分阶段实现路线图。每个 Phase 独立可交付、独立可验证价值。

---

## 实现路线图总览

```
Phase 1 (MVP)           Phase 2               Phase 3               Phase 4
│                       │                     │                     │
│ 基础记忆 + 观察        │ 原型构造 + 提问      │ 固化 + 退化          │ 架构治理
│                       │                     │                     │
│ • SalientElement 存储  │ • ProtoStructure     │ • Crystallization   │ • Level 3 结构重组
│ • 场景匹配框架         │   自动构造            │ • Degradation 检测   │ • 架构版本管理
│ • 静默感知             │ • 主动提问            │ • 置信度仪表盘       │ • 回归护栏
│ • 人工 review          │ • 预测标记协议        │ • 用户体验闭环       │ • 审计报告
│                       │                     │                     │
│ 目标: 验证数据采集可行  │ 目标: 验证自动归纳可行 │ 目标: 验证价值闭环   │ 目标: 长期稳定运行
│                       │                     │                     │
├──────── 2-3 周 ────────┼─────── 3-4 周 ──────┼─────── 3-4 周 ──────┼─────── 2-3 周 ──────┤
│                       │                     │                     │
▼                       ▼                     ▼                     ▼
总计: 约 3 个月到 MVP 完整功能，约 4-5 个月到 Phase 4
```

---

## Phase 1: 基础记忆 + 静默观察（2-3 周）

### 目标
验证 Praxis 能否在真实使用中正确采集和存储 SalientElement，不引入明显延迟。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **场景匹配器** | `scene-matcher.ts` — 消息 → 场景识别 + 适配度计算 | P0 |
| **SalientElement 标记器** | `salience-marker.ts` — 本地预标记（5 种信号） | P0 |
| **SalientElement 存储** | AgentMemory `memory_save(type="salient_element")` | P0 |
| **记忆 buffer** | 会话内临时存储（不跨会话可见） | P0 |
| **session_end 精化** | 去重 + 过滤 + 分类 + 持久化 | P0 |
| **感知仪表盘** | `/praxis perceive` 命令 — 查看当前场景的观察状态 | P1 |
| **session_start 加载** | 加载 active_proto_structures（此时为空） | P1 |

### Phase 1 明确不做

- ❌ 不构造 ProtoStructure（只有 SalientElement）
- ❌ 不主动向用户提问
- ❌ 不修改 LLM 的系统提示（完全静默）
- ❌ 不使用预测标记协议
- ❌ 不调用 LLM 做分析（纯本地逻辑）

### Phase 1 验证标准

```
✅ SalientElement 准确率（人工 review 20 个元素 → 至少 60% "确实是 salient"）
✅ session_end 延迟 < 2 秒（仅本地处理 + AgentMemory 写操作）
✅ message_received 额外延迟 < 50ms（仅正则 + 内存操作）
✅ 不影响 Agent 的正常回复质量（A/B 对比测试: 开启/关闭 Praxis 时的回复质量无差异）
```

### Phase 1 关键风险

| 风险 | 缓解 |
|------|------|
| 本地预标记质量差（噪声 > 80%） | Phase 1 让用户手动 review `/praxis perceive` 的前 20 个元素，人工校准正则规则 |
| AgentMemory 写操作在 session_end 中超时 | 使用 memory_slot_append 而非逐个 memory_save；批量写入 |

---

## Phase 2: 原型构造 + 主动提问（3-4 周）

### 目标
验证 LLM 能否从 SalientElement 的正确构造 ProtoStructure，并验证主动提问是否改善认知速度。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **统计模式检测器** | `pattern-detector.ts` — 共现对检测 + PMI 计算 | P0 |
| **Proto 构造器** | `proto-constructor.ts` — 统计预筛选 + LLM 语义归纳 | P0 |
| **ProtoStructure 存储** | AgentMemory slot `active_proto_structures` | P0 |
| **预测标记协议** | `prediction-protocol.ts` — `[PREDICTION_FAILED]` 标记 | P0 |
| **置信度更新器** | `confidence-updater.ts` — 成功 +0.1*(1-c), 失败 -0.2*c | P0 |
| **agent_end 解析** | 解析 Agent 输出中的预测标记 → 更新置信度 | P0 |
| **系统提示注入** | 零先验场景 → 注入 open-perception + proto-structure 模板 | P0 |
| **感知摘要** | session_start 时如果 ProtoStructure 更新 → 展示感知摘要 | P1 |
| **主动提问框架** | 待验证问题 → 注入系统提示 → Agent 在合适时机提问 | P1 |
| **原型仪表盘** | `/praxis proto <id>` 查看置信度历史 | P1 |

### Phase 2 明确不做

- ❌ 不固化 ProtoStructure（Phase 3）
- ❌ 不检测退化（Phase 3）
- ❌ 不修改架构结构（Phase 4）
- ❌ 不运行 cron 分析任务（Phase 3+）

### Phase 2 验证标准

```
✅ ProtoSequence 准确率（人工 review 10 个序列 → 至少 50% "大致正确"）
✅ 置信度更新方向正确（成功 → 上升, 失败 → 下降, 不确定 → 不变）
✅ 预测标记协议被 Agent LLM 正确使用（至少 70% 的违反模式被标记）
✅ session_end LLM 分析延迟 < 15 秒（用户无感知——会话已结束）
✅ 主动提问不超过 2 次/会话（不过度打扰用户）
```

### Phase 2 关键实验

| 实验 | 方法 | 决策标准 |
|------|------|---------|
| **LLM 归纳质量** | 人工构造 20 个场景的 SalientElement → 让 LLM 归纳 → 人工评分 | 准确率 > 50% → 继续自动化；< 30% → 改为人工构造 ProtoStructure |
| **置信度校准** | 运行 50 次预测 → 比较置信度与实际准确率 | 置信度 0.8 的预测实际准确率应在 70-90% 之间 |
| **主动提问频率** | 统计 20 次会话中的提问次数和用户回复率 | 用户回复率 > 50% → 保持；< 30% → 减少提问或改变措辞 |

---

## Phase 3: 固化 + 退化（3-4 周）

### 目标
实现 ProtoStructure → CognitiveStructure 的完整生命周期闭环，验证"从零到专家"的端到端流程。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **固化提案生成器** | 置信度达标 → 数据格式转换 → 提案 | P0 |
| **固化审批流程** | `/praxis crystallize approve/reject/edit` | P0 |
| **固化执行器** | 批准 → 数据从 proto slot 移到 structure_registry slot | P0 |
| **退化检测器** | `degradation-checker.ts` — 准确率/反例/用户标记 | P0 |
| **退化执行器** | structure → degraded → proto（保留数据） | P0 |
| **每周 cron** | pattern_audit + degradation_check cron 任务 | P1 |
| **置信度仪表盘** | `/praxis perceive` 增强版（含趋势图描述） | P1 |
| **用户纠正处理** | 用户说"不对" → 高权重信号直接调整置信度 | P1 |
| **学习事件完整记录** | 23 种学习事件类型全部实现 | P1 |

### Phase 3 验证标准

```
✅ 固化提案质量（人工 review 前 10 个提案 → 至少 70% 被批准或小幅修改后批准）
✅ 退化检测准确（已知退化案例 → 100% 检测到；误报 < 20%）
✅ 端到端验证: 用 5 个模拟零先验场景测试完整生命周期
   → "虚拟医院"、"虚拟政务大厅"、"虚拟租房"、"虚拟学校"、"虚拟银行"
✅ 固化结构在后续使用中确实改善了 Agent 表现（任务完成时间减少或质量提升）
```

### Phase 3 关键里程碑

```
里程碑 A: 第一个成功的固化
  → 某个场景的 ProtoSequence 置信度从 0.3 → 0.8 → 用户批准固化
  → 证明: 零先验 → 固化 的路径是通的

里程碑 B: 第一个成功的退化
  → 某个固化结构在新场景中频繁失败 → 自动退化 → 重新进入原型状态
  → 证明: 退化机制有效保护了系统不被错误结构固化

里程碑 C: 第一次成功的"再固化"
  → 退化的结构经过修正 → 置信度重新达标 → 再次固化（更好的版本）
  → 证明: 演化循环闭合
```

---

## Phase 4: 架构治理（2-3 周）

### 目标
实现架构级变更的治理机制，确保长期运行的稳定性和可控性。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **架构审计器** | `architecture-auditor.ts` — 每月分析 ArchitectureGap | P0 |
| **架构版本管理** | `architecture_version` slot + 版本号规则 (major.minor.patch) | P0 |
| **回归护栏** | 核心指标监控 + 退化 > 5% → 自动暂停 + 通知 | P0 |
| **紧急冻结** | `/praxis architecture freeze/unfreeze` | P0 |
| **Level 3 结构重组** | CognitiveStructure 间关系管理（非代码级重构） | P1 |
| **运维者仪表盘** | `/praxis architecture status/proposals/rollback` | P1 |
| **结构演化追溯** | `StructureEvolution` 完整记录 → 可追溯任何结构的演化路径 | P1 |
| **外部审核流程** | Level 5 变更的外部专家审核工作流（基础版） | P2 |

### Phase 4 明确不做

- ❌ Level 4-6 的代码级架构自修改（defer 到后续版本）
- ❌ 外部专家审核的自动化（仅提供流程框架）
- ❌ 跨 Praxis 实例的结构共享

### Phase 4 验证标准

```
✅ 回归护栏: 模拟核心指标退化 8% → 自动暂停触发（10 分钟内）
✅ 紧急冻结: /praxis architecture freeze → Level 3+ 修改全部暂停
✅ 版本回滚: /praxis architecture rollback v1.2.0 → 成功恢复旧版本的结构集合
✅ 审计报告: 每月生成一份可读的架构健康报告
```

---

## 实施优先级矩阵

```
                        高价值                    低价值
                      ┌────────────┬────────────┐
                高    │ Phase 1    │            │
                │     │ SalientElement│         │
                │     │ 场景匹配    │            │
          实施难度    ├────────────┼────────────┤
                │     │ Phase 2    │ Phase 4    │
                │     │ Proto构造   │ 架构治理    │
                低    │ Phase 3    │            │
                      │ 固化+退化   │            │
                      └────────────┴────────────┘

推荐顺序: Phase 1 → Phase 2 → Phase 3 → Phase 4
（每个 Phase 依赖前一个 Phase 的产出）
```

---

## 测试策略

### 单元测试（每个 Phase 同步进行）

| 测试目标 | 工具 | 覆盖要求 |
|---------|------|---------|
| salience-marker | 100 条人工标注消息 → 验证检测率和误报率 | 检测率 > 80%, 误报 < 30% |
| confidence-updater | 50 组 (预测结果, 旧置信度) → 验证方向和幅度 | 100% 方向正确 |
| scene-matcher | 20 个场景 × 5 条消息 → 验证匹配准确率 | Top-3 匹配包含正确答案 > 80% |
| degradation-checker | 20 个人工构造的退化/正常场景 | 退化检测 100%, 误报 < 20% |

### 集成测试（Phase 2 开始）

```
测试场景: "模拟医院" (5 次虚拟会话)
  ├─ 第 1 次: Praxis 零先验 → 标记 SalientElement
  ├─ 第 2 次: 检测到初始共现 → 形成低置信度 ProtoSequence
  ├─ 第 3 次: ProtoSequence 置信度通过互动验证上升
  ├─ 第 4 次: 置信度接近 0.8 → 生成固化提案
  └─ 第 5 次: 用户批准 → 固化 → 第 6 次使用固化结构
  验证: 全过程数据一致性 + 置信度单调性（无意外跳跃）
```

### 性能测试

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| message_received 额外延迟 | < 50ms | 计时 hook 回调前后 |
| session_end 额外延迟 | < 5s (Phase 1), < 20s (Phase 2+) | 计时 hook 回调 |
| AgentMemory 读操作 | < 500ms | 计时 memory_slot_get |
| AgentMemory 写操作 | < 1s (单次), < 5s (批量) | 计时 memory_save |
| LLM 分析调用 (session_end) | < 15s | 计时 LLM API 调用 |
| 系统提示 token 增量 | < 500 tokens (确定场景), < 1000 tokens (零先验) | 统计注入文本 token 数 |

---

## 兄弟文件

- [What is Praxis V7?](what-is.md) — V7 的工程定义
- [Why Praxis V7?](why.md) — 第一性原理工程可行性分析
- [Who is it for?](who.md) — 开发者、运维者、用户三角色
- [How does it work?](how.md) — Hook 编排、Prompt 工程、数据流详解
- [Where does it sit?](where.md) — 工程架构与模块划分
- [Architecture Design](design.md) — 技术规格与 API 契约
