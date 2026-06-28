/**
 * CodexAdapter — OpenAI Codex CLI 适配器
 *
 * 职责:
 *   - 将 Codex CLI 事件映射为 Praxis 标准生命周期事件
 *   - 将 Praxis 决策映射为 Codex 可执行指令
 *   - 纯函数, 无状态, 不做认知处理
 *
 * T18: 使用共享 base-adapter 工厂。Codex 映射逻辑与默认完全一致。
 *
 * 架构参考: §1 三层运行时拓扑, §11 adapters/codex-adapter.ts
 */

import type { AgentRuntimeAdapter } from "./adapter-interface";
import { createBaseAdapter } from "./base-adapter";

export const codexAdapter: AgentRuntimeAdapter = createBaseAdapter("codex");
