# When does AgentOS V9 operate?

> V9 在 V8 的 3 个 Phase 上新增 Phase 0（压力感知基础设施），总 4 个 Phase ~4 个月。核心交付优先于增强交付。

---

## 一、实现路线图总览

```
Phase 0 (基础设施)       Phase 1 (核心交付)      Phase 2 (扩展)          Phase 3 (增强)
│                        │                       │                       │
│ 压力感知 + 四级压缩     │ 注意力遥测 +           │ 验证覆盖扩展 +         │ 自适应配置 +
│ + Lazy Loading         │ 工具映射增强           │ 一致性引擎             │ 生产就绪
│                        │                       │                       │
│ • context-pressure-    │ • attention-telemetry  │ • role-verifier       │ • config-adapter
│   monitor              │ • transcript-analyzer  │ • concept-verifier    │ • 成本优化
│ • context-organizer    │   工具映射输出          │ • consistency-checker │ • 遥测仪表盘
│   四级压缩变体          │ • statistical-verifier │                       │ • 生产压力测试
│ • recall-structure     │   工具映射匹配          │                       │
│                        │                       │                       │
│ 目标: 消除 token 爆炸  │ 目标: 关闭盲区          │ 目标: 验证覆盖         │ 目标: 长期稳定
│ 的系统性风险            │                       │                       │
│                        │                       │                       │
├────── 3-4 周 ──────────┼────── 3-4 周 ─────────┼────── 4-5 周 ─────────┼────── 3-4 周 ──────┤
│                        │                       │                       │
▼                        ▼                       ▼                       ▼
总计: 约 4 个月到完整功能
```

---

## 二、Phase 0: 压力感知基础设施（3-4 周）⭐ 最高优先级

### 目标
消除 V8 在复杂连续任务中 token 爆炸的系统性风险。Phase 0 完成后，AgentOS 在任何上下文压力下都能优雅运行。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **context-pressure-monitor** | 上下文 token 估算 + 四级压力判定 | P0 |
| **context-organizer (四级变体)** | Normal/Elevated/High/Critical 四种注入实现 | P0 |
| **recall-structure tool** | 按需结构检索 (Lazy Loading) | P0 |
| **critical-mode.md prompt** | Critical 模式下的精简系统指令 | P0 |
| **session-start 重写** | 集成压力测量 + 自适应注入选择 | P0 |
| **压力遥测记录** | 每次注入的压力等级 + token 使用量记录 | P1 |

### Phase 0 明确不做

- ❌ 注意力遥测（Phase 1）
- ❌ 角色/概念验证器（Phase 2）
- ❌ 一致性检查（Phase 2）
- ❌ 自适应配置（Phase 3）
- ❌ 工具映射增强（Phase 1）

### Phase 0 验证标准

```
✅ 压力等级判定准确：人工构造 10 个不同使用率的场景 → 判定与实际偏差 < 15%
✅ 四级注入行为正确：
   - Normal: 全量注入 ~30K tokens → 包含 Tier A/B/C
   - Elevated: 压缩注入 ~16K tokens → 无 Tier C
   - High: 最小注入 ~3.5K tokens → 仅 Tier A 摘要
   - Critical: 索引注入 ~1K tokens → recall_structure tool 已注册
✅ recall_structure 返回结果准确：20 个测试查询 → Top-3 包含正确答案 > 80%
✅ 压力等级切换不引入额外延迟：session_start 增加 < 5ms
✅ 回归测试：V8 所有测试仍然通过（压力感知是附加行为，不改变默认模式）
```

---

## 三、Phase 1: 注意力遥测 + 工具映射增强（3-4 周）

### 目标
关闭"注入有效 vs 碰巧做对"的盲区。消除统计验证器的语义鸿沟误匹配。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **attention-telemetry** | [STRUCTURE_USED] 标记解析 + 采用率统计 | P0 |
| **prediction-protocol 增强** | 系统提示中增加 STRUCTURE_USED 标记说明 | P0 |
| **transcript-analyzer 增强** | LLM 分析输出中增加步骤→工具映射 | P0 |
| **statistical-verifier 增强** | 使用工具映射替代裸字符重叠率 | P0 |
| **僵尸结构检测** | 每周 cron: 发现高置信低采用的异常结构 → 通知 | P1 |
| **遥测仪表盘 (基础)** | `/agentos telemetry` — 结构采用率排行 | P1 |

### Phase 1 验证标准

```
✅ LLM 正确使用 [STRUCTURE_USED] 标记率 > 70% (人工验证 50 个标记)
✅ 工具映射准确率 > 80% (人工验证 LLM 输出的 possible_tool_patterns)
✅ 统计验证器的误匹配率相比 V8 降低 > 50%
✅ 僵尸结构检测: 发现至少 1 个"高置信低采用"结构 → 人工审查确认
```

---

## 四、Phase 2: 验证覆盖扩展 + 一致性引擎（4-5 周）

### 目标
V8 的验证真空补全。非序列型结构获得独立验证信号。跨结构矛盾能被主动发现。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **role-verifier** | ProtoRole 行为 vs 工具调用者模式 | P0 |
| **concept-verifier** | 对抗性 prompt 交叉验证 | P0 |
| **consistency-checker** | 跨结构矛盾扫描 | P0 |
| **confidence-fuser 增强** | 五源融合 (统计 + 角色 + 概念 + LLM标记 + 用户) | P0 |
| **after-tool-call 增强** | 记录工具调用者信息 → role-verifier 用 | P1 |

### Phase 2 验证标准

```
✅ ProtoRole 验证准确率 > 70% (10 个角色 × 人工验证)
✅ ProtoConcept 验证的误报率 < 30%
✅ 一致性扫描: 在包含已知矛盾的数据集中 → 100% 检测到
✅ 五源融合: 置信度收敛曲线比 V8 三源版本更平滑 (更少振荡)
```

---

## 五、Phase 3: 自适应配置 + 生产就绪（3-4 周）

### 目标
减少运维负担。系统关键参数自我调优。生产级性能优化。

### 交付物

| 模块 | 内容 | 优先级 |
|------|------|--------|
| **config-adapter** | 关键参数基于历史数据的自动校准 | P0 |
| **成本优化** | 分析调用的 token 消耗监控 + 自适应降频 | P1 |
| **遥测仪表盘 (完整)** | 压力历史 + 采用率趋势 + 配置变更日志 | P1 |
| **生产压力测试** | 模拟 200 结构 + 500K 对话 + 300K 文档的极端场景 | P0 |

### Phase 3 验证标准

```
✅ 自适应配置: 在 200 次会话的模拟数据上 → 关键参数收敛到合理值
✅ 压力测试: 极端场景下 AgentOS 成功降级到 Critical 模式 → 不崩溃
✅ 成本控制: 月度分析 API 成本 < config.analysisBudget.maxMonthlyCostUsd
✅ 端到端: 5 个零先验场景完整生命周期 (同 V7/V8)
```

---

## 六、V7 → V8 → V9 路线图对比

| 维度 | V7 | V8 | V9 |
|------|----|----|-----|
| 总 Phase | 4 | 3 | 4 (Phase 0 新增) |
| 总时长 | 4-5 个月 | 3 个月 | ~4 个月 |
| Phase 1 核心 | regex + 场景匹配 | transcript 分析 | **压力感知 + 四级压缩** |
| 统计验证 | 无 | Phase 2 | Phase 0 (继承 V8) + Phase 1 增强 |
| 注意力管理 | 无 | Phase 2 (Tier A/B/C) | Phase 1 (遥测) |
| 验证覆盖 | 仅 LLM 自报告 | 统计(PSeq) + LLM | **统计(PSeq+Role) + 对抗性(PConcept) + LLM** |
| Token 爆炸保护 | 无 | 无 (假设不会发生) | **Phase 0 (四级压缩 + Lazy Loading)** |
| 自动固化 | 无 | Phase 2 | 继承 V8 |
| 自适应配置 | 无 | 无 | Phase 3 |

---

## 七、测试策略

### V9 新增测试

| 测试目标 | 方法 | 覆盖要求 |
|---------|------|---------|
| context-pressure-monitor | 10 种不同使用率的构造场景 → 验证等级判定 | 偏差 < 15% |
| 四级注入变体 | 每个变体 → 验证输出的 token 量 + 结构完整性 | 正常/压缩/最小/索引 |
| recall-structure | 20 个查询 → 验证 Top-3 准确率 | > 80% |
| attention-telemetry | 50 个 [STRUCTURE_USED] 标记 → 人工验证 | > 70% 正确 |
| role-verifier | 10 个角色 × 构造的工具调用序列 | > 70% 准确 |
| concept-verifier | 10 个概念 × 对抗性 prompt | 误报 < 30% |
| consistency-checker | 5 组已知矛盾的构造场景 | 100% 检测 |
| config-adapter | 200 次会话模拟 → 参数收敛 | 收敛到 ±5% 范围 |

---

## 兄弟文件

- [What is AgentOS V9?](what-is.md) — V9 的工程定义
- [Why AgentOS V9?](why.md) — 第一性原理：为什么 token 爆炸需要压力感知
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 压力监测器、四级压缩、按需检索等
- [Where does it sit?](where.md) — 模块树（V8 基础 + 7 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
