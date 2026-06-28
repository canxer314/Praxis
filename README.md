# Praxis v1.0.0.0

> **AI 终于有记忆了。**  
> Praxis 是 AI 的大脑皮层——一个在 LLM 与外部世界之间运行的认知中间件。  
> 它让 AI 跨会话记住经验、从错误中学习、在执行前阻止违规，不再每次都从零开始。

---

## 它解决了什么问题？

今天所有 AI 都是**无状态**的——每次对话结束，学到的东西全部归零。  
Praxis 改变了这一点：

| 没有 Praxis | 有 Praxis |
|------------|----------|
| 每次任务从零开始 | 自动加载上次学到的经验 |
| 重复犯同样的错误 | `before_tool_call` 拦截已知违规 |
| LLM 自评不可靠 | 7 个独立信号源验证置信度 |
| 上下文爆炸时全丢 | 4 级压力自适应 + 按需加载 |
| 不知道学了什么 | `/praxis ontology` 查看全部认知结构 |

---

## 5 分钟上手

### 前置条件

- **Claude Code** (或其他支持的 Agent 运行时)
- **bun** (`irm bun.sh/install.ps1 | iex` 或 `curl -fsSL https://bun.sh/install | bash`)
- **AgentMemory** (可选 — 无 AgentMemory 时以 local-cache 降级模式运行)

### 安装

```bash
# Windows (PowerShell)
.\scripts\install.ps1

# macOS / Linux
chmod +x scripts/install.sh && ./scripts/install.sh
```

安装脚本自动完成：
1. 检测/安装 bun 运行时
2. 安装 npm 依赖
3. 注册 Claude Code hooks (SessionStart / Stop / UserPromptSubmit)
4. 配置 AgentMemory MCP 连接（可选）
5. 在 `.claude/settings.json` 中写入完整配置

### 手动配置

如果你使用不同的 Agent 运行时，手动设置：

**Claude Code** — 在 `.claude/settings.json` 中添加:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "bun scripts/praxis-hook.ts session_start \"$CLAUDE_SESSION_ID\"",
        "shell": "powershell"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "bun scripts/praxis-hook.ts agent_end \"$CLAUDE_SESSION_ID\"",
        "shell": "powershell"
      }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "bun scripts/praxis-hook.ts message_received \"$CLAUDE_SESSION_ID\"",
        "shell": "powershell",
        "timeout": 45
      }]
    }]
  }
}
```

**OpenClaw / Hermes / Codex** — 使用对应的适配器:

```ts
import { EventOrchestrator, buildM0Deps } from "@praxis/cognitive-core";
import { openclawAdapter } from "./adapters/openclaw-adapter";

const deps = buildM0Deps();
const orch = new EventOrchestrator(deps);

// 将你的运行时事件映射到 Praxis
const event = openclawAdapter.mapToSessionStart(rawEvent);
await orch.route(event);
```

### 第一个 Session

重启 Claude Code 后，Praxis 自动工作。首次 `session_start` 会初始化认知引擎：

```
[Praxis Phase5] session_start OK — session-count: 1, maturity: novice, pressure: normal
```

发送几条消息后，`session_end` 自动提取学习：

```
[Praxis Phase5] session_end OK — fused: 3 structures, lessons: 2, progress: updated
```

### 查看学习成果

```bash
# 查看所有认知结构
/praxis ontology

# 查看能力模型
/praxis status

# 查看审计报告
/praxis audit
```

---

## 它学什么？

Praxis 从对话和工具调用中自动提取 **5 种认知结构**：

| 结构 | 学到什么 | 例子 |
|------|---------|------|
| **ProtoSequence** | 行为序列模式 | "这个项目部署流程是: lint→test→build→deploy→verify" |
| **ProtoConstraint** | 绝对不能做的事 | "数据库迁移前必须先备份" |
| **ProtoConcept** | 领域概念定义 | "分诊是指根据病情紧急程度分配就诊优先级" |
| **ProtoRole** | 谁负责什么 | "后端负责 API，前端负责 UI，DevOps 负责部署" |
| **ProtoPurpose** | 为什么做、成功标准 | "代码审查的目的是发现盲区，不是找茬" |

每个结构带**置信度**（0-1），由 7 个独立信号源加权融合——不依赖 LLM 自评。  
置信度低于 0.2 的结构不会注入，高于 0.8 的结晶化为硬约束。

---

## 怎么防止错误？

Praxis 在 **LLM 犯错之前** 拦截：

- **block**: 绝对禁止 (`before_tool_call` 返回拒绝)
- **confirm**: 暂停等待用户确认
- **warn**: 执行但记录审计日志

三次观察 + 无违规 → 自动结晶化为 block 级约束。

---

## 上下文不够怎么办？

Praxis 在每次注入前测量上下文利用率，按 4 级压力自适应：

| 压力 | 剩余 Token | 注入策略 |
|------|-----------|---------|
| Normal | > 400K | 全量详情 |
| Elevated | 250-400K | 相关详情 + 其他摘要 |
| High | 100-250K | 仅核心摘要 |
| Critical | < 50K | 仅结构索引 + 按需拉取 |

即使上下文仅剩 1K token，LLM 仍知道所有结构存在——需要时调用 `recall_structure("...")` 拉取详情。

---

## 它能自行发现"自己还缺什么"吗？

能。Meta Layer 定期审计框架本身：
- **范畴盲区**: 现有 5 种 ProtoStructure 类型都无法捕获的重复模式？
- **僵尸结构**: 置信度高但 LLM 从不使用的"死结构"
- **衰退检测**: 60 天未引用的结构标记为待退役

---

## 当前状态

**873 测试 · 71 文件 · TypeScript strict · typecheck clean**

所有架构模块已实现。5 个 Agent 运行时适配器（OpenClaw / Claude Code / Hermes / Codex）就绪。

技术规格: [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md)  
架构文档: [`architech/praxis-architecture.md`](architech/praxis-architecture.md)  
开发路线: [`docs/ROADMAP.md`](docs/ROADMAP.md)
