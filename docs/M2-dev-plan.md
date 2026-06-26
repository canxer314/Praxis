# M2 开发计划: 上下文编排

> 目标: 注入从 M1 的"全堆进去"升级为智能编排  
> 周期: 4-5 周  
> 前置: M1 完成 (ProtoStructure 完整数据模型)  
> 架构参考: [praxis-architecture.md](../architech/praxis-architecture.md) §7 (上下文编排系统)  
> 路线图参考: [ROADMAP.md](ROADMAP.md) M2 节

---

## 〇、Step 0: 现有代码审计

### 可直接复用

| 文件 | 原因 | 微调 |
|------|------|------|
| `scene-recognizer.ts` | 已有 LLM 场景识别能力 | 可能需增强：输出 scenario_id + confidence |
| `session-start.ts` | 已有 M1 的 ProtoStructure 基本注入 | 需重写注入段为 Tier A/B/C 分层 |
| `m0-deps.ts` | M0Deps 接口可扩展 | 新增 LLM client 的 analyzeContext 方法 |

### 需要大幅修改

| 文件 | 问题 | 重构方向 |
|------|------|---------|
| `session-start.ts` | M1 注入是无差别的全量注入 | 替换为 context-organizer 驱动的分层注入 |
| `context.ts` | V1 时代的 buildContextInjection | 改为从 M0Deps 注入 Tier A/B/C 结果 |

### M2 新增文件

`context-organizer.ts`, `context-pressure-monitor.ts`, `attention-telemetry.ts`, `task-context.ts`

---

## 一、架构决策

### A1: 分层注入流程

```
session_start
  ↓
scene-recognizer → 识别当前场景 (scenario_ids[])
  ↓
task-context → 加载当前 TaskContext (task_id, phase, relevant_scenarios)
  ↓
context-pressure-monitor → 测量上下文利用率 → 选择注入策略
  ↓
context-organizer → 
  1. 检索 ProtoStructures (按 scenario_id + task relevance)
  2. 按权重排序: 场景匹配度×0.55 + 任务相关性×0.35 + 信号推荐×0.10
  3. 按压力级别分层: Tier A/B/C
  4. 按认知成熟度调整语义粒度
  ↓
system prompt 注入
```

### A2: 新旧代码边界

- `context-organizer.ts` 是纯函数模块——接收 ProtoStructures + 场景 + TaskContext → 返回排序分层的 Tier 列表
- `session-start.ts` 的 `handle()` 改为调用 context-organizer，不再自己遍历 ProtoStructures
- `context-pressure-monitor.ts` 在 session_start 时测量上下文利用率，决定 Normal/Elevated/High/Critical
- 已有的 `loadProtoStructures()` 方法保留，但排序/分层逻辑移到 context-organizer

---

## 二、逐步骤行动计划

### Step 1: Tier A/B/C 分层组织 (Week 1-2)

**1.1 实现 `context-organizer.ts` `[P0]`**

纯函数模块:

```typescript
// 输入
organizeContext({
  structures: ProtoStructure[],      // 从 AgentMemory 检索的所有结构
  scenarios: ScenarioMatch[],        // scene-recognizer 输出
  taskContext: TaskContext | null,   // 当前任务上下文
  pressure: PressureLevel,           // 上下文压力级别
  maturity: MaturityLevel,           // 认知成熟度
})

// 输出
{
  tierA: ContextTier,  // 全量详情 + 置信度校准 + 约束标记
  tierB: ContextTier,  // 摘要 + 引用 ID
  tierC: ContextTier,  // 名称 + 一行描述
}
```

排序权重: 场景匹配度 × 0.55 + 任务相关性 × 0.35 + 信号推荐 × 0.10

**验证**: 10 个结构跨 3 个场景 → Tier A 全部与当前场景匹配 → Tier B 间接相关 → Tier C 其余

**1.2 重构 `session-start.ts` 注入逻辑 `[P0]`**

将 M1 的 `loadProtoStructures()` 调用替换为:
- 调用 scene-recognizer 获取当前场景
- 调用 context-organizer 获取 Tier A/B/C
- 按压力级别格式化注入段

**验证**: session_start → system prompt 包含分层的 ProtoStructures

### Step 2: 四级压力自适应 (Week 2-3)

**2.1 实现 `context-pressure-monitor.ts` `[P0]`**

- 在 session_start 时估计当前上下文利用率
- 按阈值分类: Normal(>400K free) / Elevated(250-400K) / High(100-250K) / Critical(<50K)
- 注入策略切换:
  - Normal: Tier A/B/C 全量 (~30K)
  - Elevated: Tier A 全量 + Tier B 压缩 + Tier C 移除 (~16K)
  - High: 仅 Tier A 摘要 (~3.5K)
  - Critical: 结构索引 + recall_structure Lazy Loading (~1K)

**验证**: 模拟 95% 占用 → Critical → 注入约 1K → LLM 可通过 recall_structure 按需拉取

**2.2 实现 `recall-structure.ts` `[P1]`**

- LLM 可调用的工具: `recall_structure("门诊流程")` → 返回该结构的全量详情
- 在 Critical 模式下注册到 LLM 的 tool_classes

### Step 3: 注意力遥测 + 语义粒度 (Week 3-4)

**3.1 实现 `attention-telemetry.ts` `[P1]`**

- LLM 输出中解析 `[STRUCTURE_USED: proto_id]` 标记
- 追踪每个结构的采纳率
- 僵尸结构检测: confidence > 0.7 + 采纳率 < 20%
- 低估结构检测: confidence < 0.4 + 采纳率 > 60%

**验证**: 注入 5 个结构 → LLM 标记 3 个 → 遥测正确显示采纳率

**3.2 认知成熟度驱动的语义粒度 `[P1]`**

在 context-organizer 中增加成熟度参数:
- Novice (0-10 sessions): 粗粒度概括
- Competent (10-50): 中等粒度 + 关键数据
- Expert (50+): 高密度细节（数值+标准差+陷阱命中率）

成熟度 × 压力双维交互: Critical + Expert = 极少量极高密度数据

### Step 4: TaskContext (Week 4-5)

**4.1 实现 `task-context.ts` `[P1]`**

- 8 字段: task_id/name/type/current_phase/progress_summary/active_subtask/relevant_scenarios/auto_updated
- session_end LLM 自动推断进度变化
- 置信度 < 0.7 不自动更新

**验证**: 创建 TaskContext → 模拟 session → 进度自动推断

### Step 5: 跨场景语义消歧 (Week 5)

**5.1 `semantic-disambiguator.ts` `[P2]`**

- 维护同形异义词注册表
- message_received 时用场景上下文消歧
- 例如"对接": API场景→系统集成, 干系人场景→会议确认

### Step 6: 集成测试 (Week 5)

完整链路: session_start → 场景识别 → Tier A/B/C 注入 → `[STRUCTURE_USED]` 遥测 → session_end 采纳率追踪

---

## 三、测试策略

### context-organizer (核心，3-5 个)

1. 10 结构 3 场景 → 正确 Tier A/B/C 分层
2. 权重排序: 场景匹配 0.55 + 任务相关 0.35 + 信号推荐 0.10
3. Expert maturity → 比 Novice 更密集的输出
4. Critical pressure → 仅 Tier A 压缩

### context-pressure-monitor (2-3 个)

1. Normal 利用率 → Normal 压力级别
2. 95% 利用率 → Critical + Lazy Loading 模式

### attention-telemetry (2-3 个)

1. 解析 `[STRUCTURE_USED: id]` → 正确计数
2. 僵尸检测: 高 confidence + 低采纳率

---

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/context-organizer.ts` | **新建** | Tier A/B/C 分层 + 排序 + 压缩 |
| `src/context-pressure-monitor.ts` | **新建** | 四级压力测量 + 策略切换 |
| `src/attention-telemetry.ts` | **新建** | [STRUCTURE_USED] 解析 + 采纳率追踪 |
| `src/task-context.ts` | **新建** | TaskContext 读写 + 自动进度推断 |
| `src/session-start.ts` | **重构** | 替换 M1 全量注入为 context-organizer 分层注入 |
| `src/session-end.ts` | **修改** | 追加 attention-telemetry 解析 + TaskContext 更新 |
| `src/scene-recognizer.ts` | **审查** | 确认输出格式兼容 context-organizer |
| `src/memory/recall-structure.ts` | **新建** | Lazy Loading: LLM 按需拉取结构详情 |

---

## 五、M2 完成标准 (Go/No-Go)

- [ ] Tier A/B/C 分层注入正确排序和压缩
- [ ] 四级压力自适应在每种级别下正确切换注入策略
- [ ] Critical 下 Lazy Loading 可用
- [ ] 注意力遥测追踪 ≥ 20 个 session 的结构采纳率
- [ ] 认知成熟度影响注入粒度
- [ ] TaskContext 自动进度推断正确
- [ ] 每个新模块有独立测试文件
- [ ] 所有现有测试通过 (532+ tests)

---

> **立即启动**: Step 1.1 (context-organizer.ts)  
> **预计工期**: 4-5 周  
> **架构参考**: [§7 上下文编排系统](../architech/praxis-architecture.md)
