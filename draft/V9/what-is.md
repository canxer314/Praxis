# What is Praxis V9?

> V9 = 从"全量注入"到"上下文压力自适应注入"。V8 证明了 1M 上下文可以装下所有结构。V9 面对一个更尖锐的问题：**当 1M 上下文被用户数据和长对话填满时，Praxis 的注入应该怎么优雅收缩？**

## 一句话定义

**Praxis V9 引入上下文压力感知——Praxis 不再是上下文空间的"固定租户"（每次注入固定量的结构），而是一个"自适应公民"：空间充裕时全量注入，空间紧张时压缩注入，空间枯竭时退化为按需索引服务。同时 V9 补全 V8 的残余缺陷：注意力遥测（测量 LLM 实际用了哪些结构）、验证覆盖扩展（ProtoRole/Concept/Purpose 的独立验证）、工具-业务步骤映射增强（统计验证器不再误匹配）、自适应配置（46 个参数不再需要人工调优）、主动一致性引擎（跨结构矛盾检测）。**

---

## V8 → V9 演进

```
V7 的问题: Token 稀缺 — 必须"选择性注入"
            → scene-matcher 选择 → regex 预筛选 → PMI 预筛选
            → 信息损失 + 选择错误风险

V8 的答案: Token 充裕 — "全量注入 + 注意力组织"
            → 删除有损压缩步骤
            → Tier A/B/C 排序 + 置信度校准
            → 新问题: 复杂连续任务中 token 仍然可能不够用

V9 的答案: Token 充裕时全量，紧张时压缩，枯竭时按需
            → 四级压缩注入 (Normal/Elevated/High/Critical)
            → Lazy Loading (recall_structure tool)
            → 注意力遥测 (结构利用率追踪)
            → 验证覆盖扩展 (非序列型结构的独立验证)
            → 自适应配置 (参数自动调优)
```

---

## V9 的七个工程命题

### 命题 1：上下文压力感知 — Praxis 是自适应公民，不是固定租户

```
V8: 每次 session_start 注入固定量的结构 (~30K tokens)
     → 对话短时浪费空间，对话长时挤压任务空间

V9: 每次 session_start 测量当前上下文使用率
     → Normal (< 60%): 全量注入 (~30K)
     → Elevated (60-75%): 压缩注入 (~16K)
     → High (75-90%): 最小注入 (~3.5K)
     → Critical (> 90%): 索引 + 按需检索 (~1K)

这不是"选择性注入"——V7 按场景匹配度选择，LLM 不知道被排除的结构存在。
V9 即使在 Critical 级别，LLM 仍知道所有结构的存在（通过索引），
可以主动拉取完整详情（通过 recall_structure tool）。
```

### 命题 2：按需结构检索 — LLM 主动拉取，而非被动接收

```
V8: Praxis 推送给 LLM → LLM 被动消费
V9: Critical 压力下 → 注入精简索引 + recall_structure tool
     LLM 需要某个结构的详情时 → 主动调用 recall_structure("门诊流程")
     → Praxis 从内存中检索完整详情 → 注入到 tool result
     
类比: V8 是自助餐（全摆出来），V9 Critical 是点餐（给菜单，要什么现做）。
```

### 命题 3：注意力遥测 — 结构利用率可测量

```
V8 的盲区: 注入后不知道 LLM 是否用了
V9: LLM 在系统提示中被要求标记 [STRUCTURE_USED: proto_id]
     → 统计每个结构的实际采用率
     → 发现"高置信度但低采用率"的僵尸结构
     → 发现"低置信度但高采用率"的隐性关键结构
```

### 命题 4：验证覆盖扩展 — 非序列型结构不再处于验证真空

```
V8: 统计验证器仅覆盖 ProtoSequence (25%)
V9: ProtoRole → 角色行为 vs 实际工具调用者模式
     ProtoConcept → 对抗性 prompt 交叉验证
     ProtoPurpose → 用户目标完成度关联验证
```

### 命题 5：工具-业务步骤映射增强 — 消除统计验证的误匹配

```
V8: fuzzyMatchScore("挂号", "create_medical_appointment")
     → 字符重叠率 ≈ 0 → 误报失败
V9: ProtoSequence 构造时 LLM 同时输出工具映射
     → "挂号 → possible_tools: [create_appointment, book_visit, register]"
     → 统计验证器使用工具映射而非裸字符匹配
```

### 命题 6：自适应配置 — 参数自我调优

```
V8: 46 个可配置参数 → 无人能调 → 默认值驱动
V9: 关键参数根据使用数据自动调整
     → 例如: crystallization threshold 根据用户审批历史自动校准
     → 例如: degradation threshold 根据历史误报率调整
     → 运维者可以锁定任何参数（覆盖自动调整）
```

### 命题 7：主动一致性引擎 — 发现矛盾，不等用户报告

```
V8: 所有验证是被动的 — 等 LLM 标记 / 等工具不匹配 / 等用户纠正
V9: session_end 中增加跨结构一致性扫描
     → ProtoSequence A vs ProtoSequence B 是否矛盾？
     → ProtoRole 行为 vs ProtoSequence 步骤是否一致？
     → 矛盾 → 降低双方置信度 + 标记为待验证
```

---

## V8 → V9 完整变化矩阵

| 维度 | V8 | V9 | 变化原因 |
|------|----|----|---------|
| 注入策略 | 全量注入 (固定) | **四级压缩注入 (自适应)** | Token 爆炸风险 |
| 结构访问 | 全部推送 | **推送 + 按需拉取 (Lazy Loading)** | Critical 压力下的兜底 |
| 注意力管理 | Tier A/B/C 排序 | **排序 + 利用率追踪** | 关闭"注入 vs 使用"盲区 |
| 统计验证覆盖 | 仅 ProtoSequence | **ProtoRole + ProtoConcept + ProtoPurpose** | V8 验证真空的延伸 |
| 工具映射 | 字符重叠率 | **LLM 预标注工具映射 + embedding 匹配** | 降低统计验证误匹配 |
| 配置管理 | 46 个参数手动调 | **关键参数自适应 + 手动锁定** | 运维可用性 |
| 一致性检查 | 无 | **session_end 跨结构一致性扫描** | 不等用户报告矛盾 |
| 上下文压力感知 | 无 | **四级压力监测 + 动态注入调整** | 复杂连续任务的核心需求 |
| 实现周期 | ~3 个月 (3 phases) | **~4 个月 (4 phases)** | 新增 7 个模块 |

---

## V9 Is / Is-not

| Is | Is-not |
|----|--------|
| V8 在上下文压力场景下的工程增强 | 新的认知能力设计 |
| 四级压缩注入 + 按需检索 | 回到 V7 的选择性注入 |
| 注意力遥测 + 验证覆盖扩展 | LLM 推理能力的替代品 |
| 自适应配置 + 主动一致性 | 不需要运维者的自动系统 |
| Token 爆炸的工程解决方案 | 上下文窗口物理极限的突破 |

---

## 兄弟文件

- [Why Praxis V9?](why.md) — 第一性原理：为什么 token 爆炸需要压力感知
- [Who is it for?](who.md) — 三角色职责变化
- [How does it work?](how.md) — 压力监测器、四级压缩、按需检索、注意力遥测等
- [When does it operate?](when.md) — 4 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V8 基础 + 7 个新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
