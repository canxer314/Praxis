# Where does AgentOS V9 sit?

> V9 在 V8 基础上的模块扩展：7 个新增模块、3 个增强模块。V8 的所有模块保持不变，V9 在其上叠加。

---

## 一、完整模块树

```
openclaw/src/plugins/agentos-plugin/
├── index.ts
├── config.ts                              # [增强] 新增压力阈值 + 自适应配置
│
├── hooks/
│   ├── session-start.ts                  # [重写] 场景识别 + 压力测量 + 自适应注入
│   ├── message-received.ts               # 同 V8 (归档 transcript)
│   ├── before-tool-call.ts               # 同 V8 (步骤级上下文)
│   ├── after-tool-call.ts                # [增强] 记录工具调用者信息 → ProtoRole 验证
│   ├── agent-end.ts                      # [增强] 注意力遥测 + 扩展验证 + 融合
│   └── session-end.ts                    # [增强] 一致性扫描 + 自适应累积分析
│
├── orchestration/
│   ├── context-pressure-monitor.ts       # [新 V9] 上下文压力测量 (四级判定)
│   ├── scene-recognizer.ts               # 同 V8
│   ├── context-organizer.ts              # [增强] 四级压缩注入 (Normal/Elevated/High/Critical)
│   ├── confidence-fuser.ts               # [增强] 融合 ProtoRole/Concept 验证信号
│   └── prediction-protocol.ts            # [增强] 新增 [STRUCTURE_USED] 标记解析
│
├── analysis/
│   ├── transcript-analyzer.ts            # [增强] 工具映射预标注 + 自适应分析策略
│   ├── statistical-verifier.ts           # [增强] 使用工具映射替代裸字符匹配
│   ├── role-verifier.ts                  # [新 V9] ProtoRole 独立验证
│   ├── concept-verifier.ts               # [新 V9] ProtoConcept 对抗性验证
│   ├── attention-telemetry.ts            # [新 V9] 结构利用率追踪
│   ├── consistency-checker.ts            # [新 V9] 跨结构一致性扫描
│   ├── config-adapter.ts                 # [新 V9] 关键参数自适应调优
│   ├── degradation-checker.ts            # 同 V8
│   ├── structure-lifecycle.ts            # 同 V8
│   └── architecture-auditor.ts           # 同 V8
│
├── memory/
│   ├── client.ts                         # [增强] 新增 lazy loading 查询方法
│   ├── recall-structure.ts               # [新 V9] 按需结构检索 (recall_structure tool)
│   ├── local-cache.ts                    # 同 V8
│   ├── schemas.ts
│   ├── slots.ts
│   └── queries.ts
│
├── prompts/
│   ├── system/
│   │   ├── memory-context.md             # [增强] 四级压缩模板变体
│   │   ├── prediction-markers.md         # [增强] 新增 STRUCTURE_USED 标记说明
│   │   └── critical-mode.md              # [新 V9] Critical 模式的精简指令
│   ├── analysis/
│   │   ├── extract-and-update.md         # [增强] 增加工具映射输出
│   │   ├── consistency-scan.md           # [新 V9] 跨结构一致性扫描 prompt
│   │   └── audit-architecture.md
│   └── user/
│       ├── perception-summary.md
│       └── crystallization-proposal.md
│
├── types/
│   ├── memory.ts                         # [增强] 新增遥测和验证类型
│   ├── scene.ts                          # [增强] ContextPressure + PressureLevel
│   └── hooks.ts
│
└── tests/
    ├── context-pressure-monitor.test.ts   # [新]
    ├── recall-structure.test.ts           # [新]
    ├── attention-telemetry.test.ts        # [新]
    ├── role-verifier.test.ts              # [新]
    ├── consistency-checker.test.ts        # [新]
    └── ... (V8 tests 保留)
```

---

## 二、V8 → V9 模块变化清单

### 新增模块（7 个）

| 模块 | 路径 | 职责 |
|------|------|------|
| context-pressure-monitor | `orchestration/context-pressure-monitor.ts` | 测量上下文使用率，判定四级压力等级 |
| recall-structure | `memory/recall-structure.ts` | Critical 模式下 LLM 主动拉取结构详情 |
| attention-telemetry | `analysis/attention-telemetry.ts` | 追踪 [STRUCTURE_USED] 标记，统计采用率 |
| role-verifier | `analysis/role-verifier.ts` | ProtoRole 行为 vs 工具调用者模式 |
| concept-verifier | `analysis/concept-verifier.ts` | ProtoConcept 对抗性 prompt 交叉验证 |
| consistency-checker | `analysis/consistency-checker.ts` | 跨结构矛盾检测 |
| config-adapter | `analysis/config-adapter.ts` | 关键参数基于历史数据的自适应调优 |

### 增强模块（7 个）

| 模块 | V8 → V9 变化 |
|------|------------|
| `hooks/session-start.ts` | 增加上下文压力测量 + 四级注入策略选择 |
| `hooks/agent-end.ts` | 增加注意力遥测 + ProtoRole/Concept 验证信号 |
| `hooks/session-end.ts` | 增加主动一致性扫描 |
| `orchestration/context-organizer.ts` | 增加四级压缩变体 (organizeContextNormal / Elevated / High / Critical) |
| `orchestration/confidence-fuser.ts` | 增加 ProtoRole/Concept 验证信号融合 |
| `analysis/statistical-verifier.ts` | 使用 LLM 预标注的工具映射替代字符重叠率 |
| `analysis/transcript-analyzer.ts` | LLM 输出中增加步骤→工具映射 |

---

## 三、数据流全景（V9 修订）

```
                      ┌─────────────────────────┐
                      │     AgentMemory MCP       │
                      │  + local-cache (降级)     │
                      └──────────┬───────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                   ▼
┌──────────────────────────────────────────────────────────────┐
│                    AgentOS Plugin (V9)                        │
│                                                               │
│  session_start:                                               │
│    1. 全量加载结构到内存                                       │
│    2. 场景识别 (scene-recognizer)                              │
│    3. 【新 V9】上下文压力测量 (context-pressure-monitor):      │
│       ├─ 估算各部分 token 消耗                                 │
│       ├─ 计算使用率 + 剩余空间                                 │
│       ├─ 判定压力等级: Normal / Elevated / High / Critical     │
│       └─ 分配 AgentOS 注入预算                                 │
│    4. 【增强】自适应注入 (context-organizer):                  │
│       ├─ Normal:  全量注入 (~30K tokens)                      │
│       ├─ Elevated: 压缩注入 (~16K tokens)                     │
│       ├─ High:    最小注入 (~3.5K tokens)                     │
│       └─ Critical: 索引 + recall_structure tool (~1K tokens)  │
│    5. 注入系统提示                                             │
│                                                               │
│  agent_end:                                                   │
│    1. 统计验证 (增强: 工具映射)                                │
│    2. 【新 V9】ProtoRole 验证 (role-verifier)                  │
│    3. LLM 标记解析 (prediction-protocol)                       │
│    4. 【新 V9】注意力遥测: 解析 [STRUCTURE_USED] → 采用率     │
│    5. 置信度融合 (增强: 三源 → 五源)                           │
│                                                               │
│  session_end:                                                 │
│    1. transcript 持久化                                        │
│    2. 累积 transcript 分析 (增强: 工具映射输出)                │
│    3. 【新 V9】ProtoConcept 对抗性验证                          │
│    4. 【新 V9】主动一致性扫描 (consistency-checker)            │
│    5. 实时退化检测                                             │
│    6. 固化检查                                                 │
│    7. 【新 V9】自适应配置校准 (config-adapter)                 │
│                                                               │
│  cron:                                                        │
│    1. 退化深度检测 (每周)                                       │
│    2. 架构审计 (每月)                                          │
│    3. 结构生命周期清理 (每周, V8 已有)                          │
│    4. 【新 V9】注意力遥测报告 (每周)                            │
│    5. 【新 V9】自适应配置重校准 (每月)                          │
└──────────────────────────────────────────────────────────────┘
```

---

## 四、兄弟文件

- [What is AgentOS V9?](what-is.md) — V9 的工程定义
- [Why AgentOS V9?](why.md) — 第一性原理：为什么 token 爆炸需要压力感知
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 压力监测器、四级压缩、按需检索等
- [When does it operate?](when.md) — 4 Phase 实现路线图
- [Architecture Design](design.md) — 技术规格与 API 契约
