/**
 * OpenClawAdapter — M6.2 OpenClaw 运行时参考适配器
 *
 * 职责:
 *   - 将 OpenClaw Hook 事件映射为 Praxis 标准生命周期事件
 *   - 将 Praxis 决策映射为 OpenClaw 可执行指令
 *   - 纯函数, 无状态, 不做认知处理
 *
 * T18: 使用共享 base-adapter 工厂，OpenClaw 映射逻辑与默认完全一致。
 *
 * 对应架构 §1 三层运行时拓扑 — OpenClaw 是第一个参考实现。
 */

import type { AgentRuntimeAdapter } from "./adapter-interface";
import { createBaseAdapter } from "./base-adapter";

// ══════════════════════════════════════════════════════════════════
// OpenClawAdapter
// ══════════════════════════════════════════════════════════════════

export const openclawAdapter: AgentRuntimeAdapter = createBaseAdapter("openclaw");
