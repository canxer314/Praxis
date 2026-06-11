# How does Praxis V12 work?

> V12 的完整实现代码。6 个新模块 + 7 个修改模块。总代码量 ~1000 行（含注释）。

---

## 一、orchestration/task-orchestrator.ts（核心 — 两个嵌套 while() 循环状态机）

```typescript
// orchestration/task-orchestrator.ts
// V12 核心: 两个嵌套 while() 循环状态机
// V12: Hook 驱动 — session_start / session_end / message_received / before_tool_call 推进状态
// V13: 同状态机 + scheduleSessionTurn / subagent.run / requestHeartbeat 驱动

import type {
  TaskOrchestrationState, TaskState, SubtaskState,
  SubtaskDefinition, VerificationCriteria, VerificationResult,
  ActivePitfall, ProgressEvent, SubtaskResult, PitfallMatch
} from '../types/memory';
import type { PlanDocument, PlanPitfall } from '../types/memory';
import type { ProtoTask } from '../types/memory';

// ── Trigger source (V12 vs V13 解耦) ──
type TriggerSource =
  | 'hook:session_start'
  | 'hook:session_end'
  | 'cron:scheduled'         // V13
  | 'subagent:completed'     // V13
  | 'heartbeat:wake';        // V13

type ActivationMode =
  | 'inline'                 // V12: 当前 session 内联
  | 'subagent';              // V13: subagent.run() spawn

// ── 状态转移表 ──

const OUTER_TRANSITIONS: Record<TaskState, Partial<Record<string, TaskState>>> = {
  TASK_NOT_STARTED:     { 'session_start':                  'TASK_ASSESSING' },
  TASK_ASSESSING:       { 'plan_exists':                    'TASK_IN_PROGRESS',
                          'no_plan_with_task_type':         'TASK_PLAN_GENERATING' },
  TASK_PLAN_GENERATING: { 'plan_generated':                 'TASK_IN_PROGRESS' },
  TASK_IN_PROGRESS:     { 'session_end_all_subtasks_done':  'TASK_VERIFYING' },
  TASK_VERIFYING:       { 'all_verified_more_phases':       'TASK_IN_PROGRESS',
                          'all_verified_last_phase':         'TASK_COMPLETE',
                          'gaps_found':                      'TASK_ITERATING' },
  TASK_ITERATING:       { 'session_start':                  'TASK_IN_PROGRESS' },
  TASK_COMPLETE:        {},  // 终态
  TASK_ABANDONED:       {},  // 终态
};

const INNER_TRANSITIONS: Record<SubtaskState, Partial<Record<string, SubtaskState>>> = {
  SUBTASK_PENDING:    { 'activate':                        'SUBTASK_ACTIVE' },
  SUBTASK_ACTIVE:     { 'completion_signal':               'SUBTASK_COMPLETING',
                        'user_correction_severe':           'SUBTASK_BLOCKED',
                        'tool_violation_threshold':         'SUBTASK_BLOCKED' },
  SUBTASK_BLOCKED:    { 'correction_resolved':              'SUBTASK_ACTIVE' },
  SUBTASK_COMPLETING: { 'verification_pass':               'SUBTASK_VERIFIED',
                        'verification_fail':                'SUBTASK_FAILED' },
  SUBTASK_FAILED:     { 'remediation_created':              'SUBTASK_ACTIVE' },
  SUBTASK_VERIFIED:   {},  // 终态
};

// ── 外层循环: advanceOuterLoop() ──

export function advanceOuterLoop(
  state: TaskOrchestrationState,
  event: string,
  triggerSource: TriggerSource,
  ctx?: { plan?: PlanDocument | null; verificationResults?: VerificationResult[] }
): { newState: TaskOrchestrationState; events: ProgressEvent[] } {
  const currentState = state.task_state;
  const transitions = OUTER_TRANSITIONS[currentState];
  
  if (!transitions || !(event in transitions)) {
    throw new Error(`Invalid outer loop transition: ${currentState} -> ${event}`);
  }

  const newTaskState = transitions[event];
  const progressEvents: ProgressEvent[] = [];
  const now = Date.now();

  switch (newTaskState) {
    case 'TASK_ASSESSING':
      // 加载或创建 orchestrator state（在 session_start hook 中完成）
      break;

    case 'TASK_PLAN_GENERATING':
      // plan-generator 在外部调用，这里只做状态转移
      progressEvents.push({
        timestamp: now,
        event_type: 'phase_started',
        description: `计划生成开始 (task_type: ${state.task_type})`,
        details: { trigger_source: triggerSource }
      });
      break;

    case 'TASK_IN_PROGRESS':
      if (currentState === 'TASK_PLAN_GENERATING' && ctx?.plan) {
        state.plan = ctx.plan;
        state.current_plan_version = ctx.plan.version;
        // 激活第一个 PENDING 子任务
        const firstPending = state.subtasks.find(s => s.state === 'SUBTASK_PENDING');
        if (firstPending) {
          activateSubtask(state, firstPending.subtask_id, 'inline');
        }
      }
      if (currentState === 'TASK_VERIFYING' || currentState === 'TASK_ITERATING') {
        // Phase 推进或补救子任务就绪
        const nextPending = state.subtasks.find(s => s.state === 'SUBTASK_PENDING');
        if (nextPending) {
          activateSubtask(state, nextPending.subtask_id, 'inline');
        }
      }
      break;

    case 'TASK_VERIFYING':
      // 所有子任务完成 → 验收（在 session_end hook 中由 verifier 执行）
      break;

    case 'TASK_COMPLETE':
      state.completed_count = state.subtasks.filter(s => s.state === 'SUBTASK_VERIFIED').length;
      progressEvents.push({
        timestamp: now,
        event_type: 'task_complete',
        description: `任务完成: ${state.subtasks.length} 个子任务, ${state.completed_count} 已验证`,
        details: { phases_completed: state.current_phase_index + 1 }
      });
      break;

    case 'TASK_ITERATING':
      // verifier 发现了 gap → 生成补救子任务
      if (ctx?.verificationResults) {
        const failedResults = ctx.verificationResults.filter(r => r.overall !== 'verified');
        for (const result of failedResults) {
          for (const remediation of result.remediation) {
            const remediationSubtask: SubtaskDefinition = {
              subtask_id: `sub_remediation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              subtask_name: `补救: ${remediation}`,
              description: `修复验收失败: ${remediation}`,
              phase_name: state.plan?.phases[state.current_phase_index]?.phase_name ?? 'Unknown',
              phase_index: state.current_phase_index,
              proto_task_id: state.plan?.source_proto_task_id ?? '',
              state: 'SUBTASK_PENDING',
              allowed_operations: ['Read', 'Write', 'Bash', 'Grep', 'Glob'],
              relevant_structures: [],
              dependencies: [],
              completion_criteria: [],
              output_artifacts: [],
              assigned_session_id: null,
              started_at: null,
              completed_at: null,
              estimated_duration_minutes: null,
              actual_duration_minutes: null,
              pitfalls_warned: [],
              pitfalls_hit: [],
              result: null,
            };
            state.subtasks.push(remediationSubtask);
          }
        }
      }
      progressEvents.push({
        timestamp: now,
        event_type: 'subtask_failed',
        description: `补救子任务已生成: ${state.subtasks.filter(s => s.state === 'SUBTASK_PENDING').length} 个待处理`,
        details: {}
      });
      break;

    case 'TASK_ABANDONED':
      progressEvents.push({
        timestamp: now,
        event_type: 'task_abandoned',
        description: '任务已放弃',
        details: { final_state: currentState }
      });
      break;
  }

  state.task_state = newTaskState;
  state.last_updated_at = now;
  state.trigger_source = triggerSource;

  return { newState: state, events: progressEvents };
}

// ── 内层循环: subtask 操作 ──

export function activateSubtask(
  state: TaskOrchestrationState,
  subtaskId: string,
  mode: ActivationMode
): SubtaskDefinition {
  const subtask = state.subtasks.find(s => s.subtask_id === subtaskId);
  if (!subtask) throw new Error(`Subtask not found: ${subtaskId}`);
  if (subtask.state !== 'SUBTASK_PENDING' && subtask.state !== 'SUBTASK_FAILED') {
    throw new Error(`Cannot activate subtask in state: ${subtask.state}`);
  }

  subtask.state = 'SUBTASK_ACTIVE';
  subtask.started_at = Date.now();
  state.active_subtask_id = subtaskId;
  state.inner_loop.current_subtask_started_at = Date.now();
  state.inner_loop.tool_call_count = 0;
  state.inner_loop.user_correction_count = 0;

  // [V13 TODO] if mode === 'subagent': await api.runtime.subagent.run({...})

  return subtask;
}

export function markSubtaskCompleting(
  state: TaskOrchestrationState,
  subtaskId: string
): void {
  const subtask = state.subtasks.find(s => s.subtask_id === subtaskId);
  if (!subtask || subtask.state !== 'SUBTASK_ACTIVE') return;
  subtask.state = 'SUBTASK_COMPLETING';
}

export function markSubtaskBlocked(
  state: TaskOrchestrationState,
  subtaskId: string,
  reason: 'user_correction' | 'tool_violation' | 'pitfall_hit',
  evidence: string
): ActivePitfall | null {
  const subtask = state.subtasks.find(s => s.subtask_id === subtaskId);
  if (!subtask || subtask.state !== 'SUBTASK_ACTIVE') return null;

  subtask.state = 'SUBTASK_BLOCKED';

  if (reason === 'pitfall_hit') {
    const activePitfall: ActivePitfall = {
      pitfall_id: `ap_${Date.now()}`,
      triggered_at: Date.now(),
      subtask_id: subtaskId,
      evidence,
      resolved: false,
      mitigation_applied: '',
    };
    state.active_pitfalls.push(activePitfall);
    state.pitfall_hit_count++;
    return activePitfall;
  }

  return null;
}

export function toolScopeGuard(
  state: TaskOrchestrationState,
  toolName: string,
  subtaskAllowedOps: string[]
): { allowed: boolean; violation?: string } {
  // 标准化工具名 (Glob → glob, Read → read)
  const normalizedTool = toolName.toLowerCase();
  const normalizedAllowed = subtaskAllowedOps.map(o => o.toLowerCase());

  if (!normalizedAllowed.includes(normalizedTool)) {
    const violation = `工具 '${toolName}' 不在当前子任务允许的操作范围内 (${subtaskAllowedOps.join(', ')})`;
    state.inner_loop.tool_call_count++;
    return { allowed: false, violation };
  }

  state.inner_loop.tool_call_count++;
  state.inner_loop.last_tool_call_at = Date.now();
  return { allowed: true };
}

export function processSubtaskOutcome(
  state: TaskOrchestrationState,
  subtaskId: string,
  outcome: 'success' | 'partial_success' | 'failure' | 'abandoned',
  criteriaResults: { criterion_id: string; status: string; evidence: string }[]
): SubtaskResult {
  const subtask = state.subtasks.find(s => s.subtask_id === subtaskId);
  if (!subtask) throw new Error(`Subtask not found: ${subtaskId}`);

  const criteria_met = criteriaResults.filter(c => c.status === 'passed').map(c => c.criterion_id);
  const criteria_missed = criteriaResults.filter(c => c.status === 'failed').map(c => c.criterion_id);

  const result: SubtaskResult = {
    outcome,
    criteria_met,
    criteria_missed,
    user_feedback: undefined,
    rework_needed: outcome === 'failure' || criteria_missed.length > 0,
    lessons_learned: [],
  };

  subtask.result = result;
  subtask.completed_at = Date.now();
  if (subtask.started_at) {
    subtask.actual_duration_minutes = Math.round((Date.now() - subtask.started_at) / 60000);
  }

  if (outcome === 'success' || (outcome === 'partial_success' && criteria_missed.length === 0)) {
    subtask.state = 'SUBTASK_VERIFIED';
    state.completed_count++;
  } else {
    subtask.state = 'SUBTASK_FAILED';
    state.failed_count++;

    // 生成 lessons learned
    if (subtask.pitfalls_hit.length > 0) {
      result.lessons_learned.push(`陷阱命中: ${subtask.pitfalls_hit.join(', ')}`);
    }
    for (const missed of criteria_missed) {
      const crit = subtask.completion_criteria.find(c => c.criterion_id === missed);
      if (crit) {
        result.lessons_learned.push(`验收失败: ${crit.description}`);
      }
    }
  }

  return result;
}

export function isAllSubtasksDone(state: TaskOrchestrationState): boolean {
  return state.subtasks.every(
    s => s.state === 'SUBTASK_VERIFIED' || s.state === 'SUBTASK_FAILED'
  ) && state.subtasks.some(s => s.state === 'SUBTASK_COMPLETING');
}

export function isPhaseComplete(state: TaskOrchestrationState): boolean {
  const currentPhase = state.current_phase_index;
  const phaseSubtasks = state.subtasks.filter(s => s.phase_index === currentPhase);
  return phaseSubtasks.length > 0 && phaseSubtasks.every(s => s.state === 'SUBTASK_VERIFIED');
}

export function getActiveSubtask(state: TaskOrchestrationState): SubtaskDefinition | null {
  if (!state.active_subtask_id) return null;
  return state.subtasks.find(s => s.subtask_id === state.active_subtask_id) ?? null;
}

export function getPhaseSubtasks(state: TaskOrchestrationState): SubtaskDefinition[] {
  return state.subtasks.filter(s => s.phase_index === state.current_phase_index);
}

export function getProgressSummary(state: TaskOrchestrationState): string {
  const total = state.subtasks.length;
  const completed = state.completed_count;
  const failed = state.failed_count;
  const active = state.subtasks.filter(s => s.state === 'SUBTASK_ACTIVE').length;
  const pending = state.subtasks.filter(s => s.state === 'SUBTASK_PENDING').length;

  let summary = `任务: ${state.plan?.task_name ?? state.task_id}\n`;
  summary += `状态: Phase ${state.current_phase_index + 1}/${state.plan?.phases.length ?? '?'}\n`;
  summary += `进度: ${completed}/${total} 已验证`;

  if (failed > 0) summary += `, ${failed} 失败`;
  if (active > 0) summary += `, ${active} 进行中`;
  if (pending > 0) summary += `, ${pending} 待处理`;

  summary += `\n陷阱命中: ${state.pitfall_hit_count}`;
  summary += `\n工具调用: ${state.inner_loop.tool_call_count}`;

  return summary;
}
```

---

## 二、orchestration/plan-generator.ts（ProtoTask → PlanDocument）

```typescript
// orchestration/plan-generator.ts
// V12: ProtoTask → PlanDocument 计划生成 (接管 planning-with-files 认知职能)
// 合并 V11: cognitive-guidance.ts + knowledge-query.ts 的认知部分

import type { PlanDocument, PlanPhase, PlanPitfall, PhaseGuidance } from '../types/memory';
import type { ProtoTask } from '../types/memory';
import type { TaskContext } from './task-context';

// ── 知识查询（原 knowledge-query 内部化） ──

export async function getProtoTaskTemplate(taskType: string): Promise<ProtoTask | null> {
  // 从 AgentMemory 查询 ProtoTask
  // memory_smart_search("proto_task", taskType) → ProtoTask | null
  // 如果不存在 → bootstrapProtoTask(taskType)
  return null; // [实现占位]
}

// ── 计划生成 ──

export interface PlanGenerationOptions {
  taskName: string;
  taskType: string;
  taskContext?: TaskContext;
  tokenBudget?: number;            // 默认 2000
  mode?: 'bootstrap' | 'cumulative' | 'hybrid';
}

export async function generatePlan(options: PlanGenerationOptions): Promise<{
  plan: PlanDocument;
  source: 'bootstrap' | 'cumulative' | 'none';
  confidence: number;
}> {
  const { taskName, taskType, tokenBudget = 2000, mode = 'hybrid' } = options;

  // 1. 获取 ProtoTask
  const protoTask = await getProtoTaskTemplate(taskType);

  if (!protoTask) {
    // 零样本: bootstrap
    return await bootstrapPlan(taskName, taskType);
  }

  // 2. 根据 ProtoTask 置信度决定模式
  const actualMode = mode === 'hybrid'
    ? (protoTask.confidence >= 0.5 ? 'cumulative' : 'bootstrap')
    : mode;

  if (actualMode === 'bootstrap') {
    return await bootstrapPlan(taskName, taskType);
  }

  // 3. 累积模式: ProtoTask → PlanDocument
  const phases = protoTask.typical_phases.map((tp, index) => {
    const guidance: PhaseGuidance = {
      phase_suggestion: `Phase ${index + 1}: ${tp.name} — 预计 ${tp.typical_duration}`,
      structure_recommendations: tp.relevant_structure_ids,
      confidence_advisory: protoTask.confidence >= 0.65
        ? '此阶段指导基于 ≥5 次观察，置信度较高'
        : '此阶段指导基于有限观察，请结合实际调整',
    };

    return {
      phase_index: index,
      phase_name: `Phase ${index + 1}: ${tp.name}`,
      description: `典型阶段: ${tp.name}。关键场景: ${tp.key_scenarios.join(', ')}`,
      expected_duration: tp.typical_duration,
      subtasks: tp.key_scenarios.map(scenario => ({
        subtask_id: `sub_${Date.now()}_${index}_${scenario.slice(0, 8)}`,
        subtask_name: `${tp.name} — ${scenario}`,
        description: `完成 '${scenario}' 相关工作`,
        phase_name: tp.name,
        phase_index: index,
        proto_task_id: protoTask.task_id,
        state: 'SUBTASK_PENDING' as const,
        allowed_operations: ['Read', 'Write', 'Bash', 'Grep', 'Glob'],
        relevant_structures: tp.relevant_structure_ids,
        dependencies: [],
        completion_criteria: [],
        output_artifacts: [],
        assigned_session_id: null,
        started_at: null,
        completed_at: null,
        estimated_duration_minutes: parseDuration(tp.typical_duration),
        actual_duration_minutes: null,
        pitfalls_warned: [],
        pitfalls_hit: [],
        result: null,
      })),
      entry_criteria: index === 0 ? ['任务已定义'] : [`Phase ${index} 所有子任务已验证`],
      exit_criteria: ['所有子任务验证通过', `Phase ${index + 1} 入口标准满足`],
      relevant_structures: tp.relevant_structure_ids,
      common_challenges: tp.common_challenges,
      guidance,
    };
  });

  const pitfalls: PlanPitfall[] = protoTask.common_pitfalls.map(cp => ({
    pitfall_id: cp.description.slice(0, 32).replace(/\s+/g, '_').toLowerCase(),
    description: cp.description,
    affected_phases: cp.affected_phases,
    mitigation: cp.mitigation,
    severity: 'medium' as const,  // 默认, 后续根据 hit_count 动态调整
    hit_count: 0,
    last_hit_task_id: null,
  }));

  // 为每个 pitfall 匹配到对应的 subtask
  for (const pitfall of pitfalls) {
    for (const phase of phases) {
      if (pitfall.affected_phases.includes(phase.phase_name.split(': ')[1] ?? '')) {
        for (const subtask of phase.subtasks) {
          subtask.pitfalls_warned.push(pitfall.pitfall_id);
        }
      }
    }
    // 根据历史命中调整 severity
    if (pitfall.hit_count >= 5) pitfall.severity = 'critical';
    else if (pitfall.hit_count >= 3) pitfall.severity = 'high';
  }

  const plan: PlanDocument = {
    plan_id: `plan_${Date.now()}`,
    version: 1,
    task_name: taskName,
    task_type: taskType,
    source_proto_task_id: protoTask.task_id,
    source_proto_task_confidence: protoTask.confidence,
    phases,
    pitfalls,
    global_criteria: [],
    created_at: Date.now(),
    updated_at: Date.now(),
    generated_by: 'cumulative',
  };

  return { plan, source: 'cumulative', confidence: protoTask.confidence };
}

// ── Bootstrap ──

async function bootstrapPlan(
  taskName: string,
  taskType: string
): Promise<{ plan: PlanDocument; source: 'bootstrap'; confidence: number }> {
  // Bootstrap: 使用 LLM 通用知识生成初始计划
  // 置信度 0.2, source: bootstrap

  const phases: PlanPhase[] = [
    {
      phase_index: 0,
      phase_name: 'Phase 1: 需求分析与规划',
      description: '明确需求范围、技术选型、架构设计',
      expected_duration: '1-2 天',
      subtasks: [createBootstrapSubtask(0, '需求分析', '需求分析与规划')],
      entry_criteria: ['任务已定义'],
      exit_criteria: ['需求文档完成', '技术方案确定'],
      relevant_structures: [],
      common_challenges: ['需求范围不明确'],
      guidance: {
        phase_suggestion: '先明确需求边界再开始设计',
        structure_recommendations: [],
        confidence_advisory: 'Bootstrap 计划 (置信度 0.2) — 基于 LLM 通用知识，不含团队特定模式',
      },
    },
    {
      phase_index: 1,
      phase_name: 'Phase 2: 实现',
      description: '核心功能开发',
      expected_duration: '3-5 天',
      subtasks: [createBootstrapSubtask(1, '核心实现', '实现')],
      entry_criteria: ['Phase 1 完成'],
      exit_criteria: ['功能开发完成', '代码审查通过'],
      relevant_structures: [],
      common_challenges: [],
      guidance: {
        phase_suggestion: '按优先级逐个实现功能模块',
        structure_recommendations: [],
        confidence_advisory: 'Bootstrap 计划 (置信度 0.2)',
      },
    },
    {
      phase_index: 2,
      phase_name: 'Phase 3: 测试与交付',
      description: '测试、文档、交付',
      expected_duration: '1-2 天',
      subtasks: [createBootstrapSubtask(2, '测试与交付', '测试与交付')],
      entry_criteria: ['Phase 2 完成'],
      exit_criteria: ['测试通过', '文档完成'],
      relevant_structures: [],
      common_challenges: [],
      guidance: {
        phase_suggestion: '确保核心流程的端到端测试覆盖',
        structure_recommendations: [],
        confidence_advisory: 'Bootstrap 计划 (置信度 0.2)',
      },
    },
  ];

  const plan: PlanDocument = {
    plan_id: `plan_bootstrap_${Date.now()}`,
    version: 1,
    task_name: taskName,
    task_type: taskType,
    source_proto_task_id: 'bootstrap',
    source_proto_task_confidence: 0.2,
    phases,
    pitfalls: [],
    global_criteria: [],
    created_at: Date.now(),
    updated_at: Date.now(),
    generated_by: 'bootstrap',
  };

  return { plan, source: 'bootstrap', confidence: 0.2 };
}

function createBootstrapSubtask(phaseIndex: number, name: string, phaseName: string): SubtaskDefinition {
  return {
    subtask_id: `sub_bootstrap_${Date.now()}_${phaseIndex}`,
    subtask_name: name,
    description: `${phaseName}的核心工作`,
    phase_name: phaseName,
    phase_index: phaseIndex,
    proto_task_id: 'bootstrap',
    state: 'SUBTASK_PENDING',
    allowed_operations: ['Read', 'Write', 'Bash', 'Grep', 'Glob'],
    relevant_structures: [],
    dependencies: [],
    completion_criteria: [],
    output_artifacts: [],
    assigned_session_id: null,
    started_at: null,
    completed_at: null,
    estimated_duration_minutes: null,
    actual_duration_minutes: null,
    pitfalls_warned: [],
    pitfalls_hit: [],
    result: null,
  };
}

function parseDuration(durationStr: string): number | null {
  // "3-4 周" → null (太粗粒度), "2-3 天" → 2*8*60, "3-5 小时" → 3*60
  const match = durationStr.match(/(\d+)/);
  if (!match) return null;
  const num = parseInt(match[1]);
  if (durationStr.includes('周')) return num * 5 * 8 * 60;
  if (durationStr.includes('天')) return num * 8 * 60;
  if (durationStr.includes('小时')) return num * 60;
  return null;
}
```

---

## 三、orchestration/verifier.ts（验收标准检查）

```typescript
// orchestration/verifier.ts
// V12: 验收标准检查 — 5 种类型

import type { VerificationCriteria, VerificationResult, SubtaskDefinition } from '../types/memory';

type VerificationType =
  | 'command_output'
  | 'file_existence'
  | 'test_pass'
  | 'llm'
  | 'user_approval';

const ALLOWED_CHECK_COMMANDS = [
  'npm test', 'npm run lint', 'npm run build',
  'cargo test', 'cargo build',
  'go test', 'go build',
  'pytest', 'python -m pytest',
];

// ── 主验收函数 ──

export async function verifyCompletion(
  subtask: SubtaskDefinition,
  options?: {
    llmEvaluator?: (prompt: string) => Promise<string>;
    runCommand?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    checkFileExists?: (path: string) => Promise<boolean>;
  }
): Promise<VerificationResult> {
  const criteriaResults: { criterion_id: string; status: string; evidence: string }[] = [];
  const now = Date.now();

  for (const criterion of subtask.completion_criteria) {
    try {
      const result = await verifySingleCriterion(criterion, options);
      criteriaResults.push(result);
    } catch (error) {
      criteriaResults.push({
        criterion_id: criterion.criterion_id,
        status: 'failed',
        evidence: `验收错误: ${(error as Error).message}`,
      });
    }
  }

  const allPassed = criteriaResults.every(c => c.status === 'passed');
  const someFailed = criteriaResults.some(c => c.status === 'failed');

  let overall: 'verified' | 'needs_rework' | 'failed';
  let remediation: string[] = [];

  if (allPassed) {
    overall = 'verified';
  } else if (someFailed) {
    overall = criteriaResults.filter(c => c.status === 'passed').length > criteriaResults.length / 2
      ? 'needs_rework'
      : 'failed';

    remediation = criteriaResults
      .filter(c => c.status === 'failed')
      .map(c => `修复验收标准: ${c.criterion_id} — ${c.evidence}`);
  } else {
    overall = 'needs_rework';
  }

  return {
    subtask_id: subtask.subtask_id,
    criteria_results: criteriaResults,
    overall,
    remediation,
  };
}

// ── 单个验收标准检查 ──

async function verifySingleCriterion(
  criterion: VerificationCriteria,
  options?: {
    llmEvaluator?: (prompt: string) => Promise<string>;
    runCommand?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    checkFileExists?: (path: string) => Promise<boolean>;
  }
): Promise<{ criterion_id: string; status: string; evidence: string }> {
  switch (criterion.type as VerificationType) {
    case 'command_output':
      return await verifyCommandOutput(criterion, options?.runCommand);
    case 'file_existence':
      return await verifyFileExistence(criterion, options?.checkFileExists);
    case 'test_pass':
      return await verifyTestPass(criterion, options?.runCommand);
    case 'llm':
      return await verifyLLM(criterion, options?.llmEvaluator);
    case 'user_approval':
      return {
        criterion_id: criterion.criterion_id,
        status: 'pending',
        evidence: '等待用户确认',
      };
    default:
      return {
        criterion_id: criterion.criterion_id,
        status: 'skipped',
        evidence: `未知验收类型: ${criterion.type}`,
      };
  }
}

// ── command_output ──

async function verifyCommandOutput(
  criterion: VerificationCriteria,
  runCommand?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): Promise<{ criterion_id: string; status: string; evidence: string }> {
  if (!criterion.check_command) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'skipped',
      evidence: '无检查命令',
    };
  }

  // 安全检查: 白名单
  const isAllowed = ALLOWED_CHECK_COMMANDS.some(allowed =>
    criterion.check_command!.startsWith(allowed)
  );
  if (!isAllowed) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'skipped',
      evidence: `命令不在白名单中: ${criterion.check_command}`,
    };
  }

  if (!runCommand) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'pending',
      evidence: '验收命令运行器不可用',
    };
  }

  try {
    const result = await runCommand(criterion.check_command);

    if (result.exitCode !== 0) {
      return {
        criterion_id: criterion.criterion_id,
        status: 'failed',
        evidence: `命令退出码 ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
      };
    }

    // 如果指定了 expected_pattern, 检查输出
    if (criterion.expected_pattern) {
      const pattern = new RegExp(criterion.expected_pattern);
      if (pattern.test(result.stdout + result.stderr)) {
        return {
          criterion_id: criterion.criterion_id,
          status: 'passed',
          evidence: `输出匹配 '${criterion.expected_pattern}'`,
        };
      } else {
        return {
          criterion_id: criterion.criterion_id,
          status: 'failed',
          evidence: `输出不匹配 '${criterion.expected_pattern}': ${result.stdout.slice(0, 200)}`,
        };
      }
    }

    // 无 expected_pattern → 退出码 0 即通过
    return {
      criterion_id: criterion.criterion_id,
      status: 'passed',
      evidence: `命令成功 (退出码 0)`,
    };
  } catch (error) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'failed',
      evidence: `命令执行错误: ${(error as Error).message}`,
    };
  }
}

// ── file_existence ──

async function verifyFileExistence(
  criterion: VerificationCriteria,
  checkFileExists?: (path: string) => Promise<boolean>
): Promise<{ criterion_id: string; status: string; evidence: string }> {
  if (!criterion.check_command) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'skipped',
      evidence: '无文件路径',
    };
  }

  if (!checkFileExists) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'pending',
      evidence: '文件检查器不可用',
    };
  }

  const filePath = criterion.check_command;  // 复用 check_command 字段存储路径
  const exists = await checkFileExists(filePath);

  return {
    criterion_id: criterion.criterion_id,
    status: exists ? 'passed' : 'failed',
    evidence: exists ? `文件存在: ${filePath}` : `文件不存在: ${filePath}`,
  };
}

// ── test_pass ──

async function verifyTestPass(
  criterion: VerificationCriteria,
  runCommand?: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): Promise<{ criterion_id: string; status: string; evidence: string }> {
  if (!criterion.check_command) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'skipped',
      evidence: '无测试命令',
    };
  }

  // 安全检查
  const testPrefixes = ['npm test', 'cargo test', 'go test', 'pytest', 'python -m pytest'];
  const isAllowed = testPrefixes.some(prefix => criterion.check_command!.startsWith(prefix));
  if (!isAllowed) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'skipped',
      evidence: `测试命令不在白名单中: ${criterion.check_command}`,
    };
  }

  if (!runCommand) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'pending',
      evidence: '测试运行器不可用',
    };
  }

  try {
    const result = await runCommand(criterion.check_command);

    if (result.exitCode !== 0) {
      // 提取失败的测试数量
      const failMatch = result.stdout.match(/(\d+)\s+failing/);
      const failCount = failMatch ? parseInt(failMatch[1]) : '?';
      return {
        criterion_id: criterion.criterion_id,
        status: 'failed',
        evidence: `${failCount} 个测试失败: ${result.stderr.slice(0, 200)}`,
      };
    }

    // 提取通过的测试数量
    const passMatch = result.stdout.match(/(\d+)\s+passing/);
    const passCount = passMatch ? parseInt(passMatch[1]) : '?';

    return {
      criterion_id: criterion.criterion_id,
      status: 'passed',
      evidence: `${passCount} 个测试通过`,
    };
  } catch (error) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'failed',
      evidence: `测试执行错误: ${(error as Error).message}`,
    };
  }
}

// ── llm ──

async function verifyLLM(
  criterion: VerificationCriteria,
  llmEvaluator?: (prompt: string) => Promise<string>
): Promise<{ criterion_id: string; status: string; evidence: string }> {
  if (!criterion.llm_check_prompt) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'skipped',
      evidence: '无 LLM 评估 prompt',
    };
  }

  if (!llmEvaluator) {
    return {
      criterion_id: criterion.criterion_id,
      status: 'pending',
      evidence: 'LLM 评估器不可用',
    };
  }

  const evaluation = await llmEvaluator(criterion.llm_check_prompt);

  // 解析 LLM 响应: 预期 "PASS" 或 "FAIL" 开头
  const verdict = evaluation.trim().toUpperCase();
  const passed = verdict.startsWith('PASS');

  return {
    criterion_id: criterion.criterion_id,
    status: passed ? 'passed' : 'failed',
    evidence: evaluation.slice(0, 500),
  };
}
```

---

## 四、orchestration/progress-tracker.ts（进度事件管理）

```typescript
// orchestration/progress-tracker.ts
// V12: Hook 驱动的进度事件记录 + 摘要生成

import type { ProgressEvent, TaskOrchestrationState } from '../types/memory';

const MAX_EVENTS = 100;  // 滚动窗口

export function recordEvent(
  eventType: ProgressEvent['event_type'],
  description: string,
  details: Record<string, unknown> = {},
  existingEvents: ProgressEvent[] = []
): ProgressEvent[] {
  const event: ProgressEvent = {
    timestamp: Date.now(),
    event_type: eventType,
    description,
    details,
  };

  const updated = [...existingEvents, event];

  // 滚动窗口
  if (updated.length > MAX_EVENTS) {
    return updated.slice(updated.length - MAX_EVENTS);
  }

  return updated;
}

export function generateSummary(events: ProgressEvent[]): string {
  if (events.length === 0) return '无进度记录';

  const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp);
  const recent = sorted.slice(0, 20);

  const summary: string[] = ['## 进度摘要'];

  // 按事件类型统计
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.event_type] = (counts[event.event_type] || 0) + 1;
  }

  if (counts['task_complete']) summary.push(`- ✅ 任务已完成`);
  if (counts['subtask_completed']) summary.push(`- 📋 ${counts['subtask_completed']} 个子任务完成`);
  if (counts['subtask_failed']) summary.push(`- ❌ ${counts['subtask_failed']} 个子任务失败`);
  if (counts['pitfall_hit']) summary.push(`- ⚠ ${counts['pitfall_hit']} 次陷阱命中`);
  if (counts['verification_run']) summary.push(`- 🔍 ${counts['verification_run']} 次验收检查`);

  summary.push('\n### 最近事件');
  for (const event of recent.slice(0, 10)) {
    const time = new Date(event.timestamp).toISOString().slice(11, 19);
    const icon = event.event_type.includes('complete') ? '✅' :
                 event.event_type.includes('fail') ? '❌' :
                 event.event_type.includes('pitfall') ? '⚠' : 'ℹ';
    summary.push(`- ${icon} [${time}] ${event.description}`);
  }

  return summary.join('\n');
}

export function getPhaseProgress(events: ProgressEvent[]): {
  phasesStarted: number;
  phasesCompleted: number;
  lastPhaseEvent: ProgressEvent | null;
} {
  const phaseStarts = events.filter(e => e.event_type === 'phase_started');
  const phaseCompletes = events.filter(e => e.event_type === 'phase_completed');
  const lastPhaseEvent = events
    .filter(e => e.event_type === 'phase_started' || e.event_type === 'phase_completed')
    .sort((a, b) => b.timestamp - a.timestamp)[0] || null;

  return {
    phasesStarted: phaseStarts.length,
    phasesCompleted: phaseCompletes.length,
    lastPhaseEvent,
  };
}
```

---

## 五、analysis/pitfall-tracker.ts（陷阱主动监控 + 反馈学习）

```typescript
// analysis/pitfall-tracker.ts
// V12: 子任务失败 ↔ ProtoTask 陷阱匹配 + 反馈到 ProtoTask 学习

import type { SubtaskResult, SubtaskDefinition, ProtoTask, PitfallMatch } from '../types/memory';

interface PitfallTrackerConfig {
  matchKeywordThreshold: number;      // 最少匹配关键词数 (默认 2)
  hitsBeforeFlag: number;             // 同一子任务命中多少次才标记 (默认 2)
  autoDowngradeMisrate: number;       // 误报率超过此值自动降 severity (默认 0.3)
}

const DEFAULT_CONFIG: PitfallTrackerConfig = {
  matchKeywordThreshold: 2,
  hitsBeforeFlag: 2,
  autoDowngradeMisrate: 0.3,
};

// ── 主匹配函数 ──

export function matchToKnownPitfalls(
  failedSubtask: SubtaskDefinition,
  protoTask: ProtoTask,
  config: PitfallTrackerConfig = DEFAULT_CONFIG
): PitfallMatch[] {
  if (!failedSubtask.result || failedSubtask.result.outcome === 'success') return [];

  const matches: PitfallMatch[] = [];

  // 收集失败证据
  const evidenceText = [
    failedSubtask.result.lessons_learned.join(' '),
    failedSubtask.result.user_feedback ?? '',
    ...failedSubtask.result.criteria_missed.map(cid => {
      const crit = failedSubtask.completion_criteria.find(c => c.criterion_id === cid);
      return crit?.description ?? cid;
    }),
  ].join(' ').toLowerCase();

  for (const pitfall of protoTask.common_pitfalls) {
    // 提取陷阱描述中的关键词
    const keywords = extractKeywords(pitfall.description);
    const matchedKeywords = keywords.filter(kw => evidenceText.includes(kw.toLowerCase()));

    if (matchedKeywords.length >= config.matchKeywordThreshold) {
      const matchConfidence = Math.min(matchedKeywords.length / keywords.length, 1.0);

      matches.push({
        pitfall_id: pitfall.description.slice(0, 32).replace(/\s+/g, '_').toLowerCase(),
        subtask_id: failedSubtask.subtask_id,
        matched_keywords: matchedKeywords,
        match_confidence: matchConfidence,
        evidence: `关键词匹配: ${matchedKeywords.join(', ')}`,
        is_false_positive: false,
      });

      // 标记子任务陷阱命中
      if (!failedSubtask.pitfalls_hit.includes(
        pitfall.description.slice(0, 32).replace(/\s+/g, '_').toLowerCase()
      )) {
        failedSubtask.pitfalls_hit.push(
          pitfall.description.slice(0, 32).replace(/\s+/g, '_').toLowerCase()
        );
      }
    }
  }

  return matches;
}

// ── 反馈到 ProtoTask 学习 ──

export function updateProtoTaskPitfallObservations(
  protoTask: ProtoTask,
  matches: PitfallMatch[]
): ProtoTask {
  for (const match of matches) {
    if (match.is_false_positive) continue;

    const pitfall = protoTask.common_pitfalls.find(
      p => p.description.slice(0, 32).replace(/\s+/g, '_').toLowerCase() === match.pitfall_id
    );
    if (!pitfall) continue;

    // 由于 ProtoTask.common_pitfalls 没有 hit_count 字段（该字段在 PlanPitfall 中），
    // 反馈通过 confidence_trend 记录
    protoTask.confidence_trend.push({
      after_observation: protoTask.observations_count,
      confidence: protoTask.confidence,
      timestamp: Date.now(),
    });
  }

  return protoTask;
}

// ── 误报控制 ──

export function analyzeFalsePositiveRate(
  matches: PitfallMatch[],
  historicalMatches: PitfallMatch[]
): { rate: number; shouldDowngrade: string[] } {
  const confirmedFalsePositives = historicalMatches.filter(m => m.is_false_positive).length;
  const totalMatches = historicalMatches.length;
  const rate = totalMatches > 0 ? confirmedFalsePositives / totalMatches : 0;

  const shouldDowngrade: string[] = [];

  if (rate > DEFAULT_CONFIG.autoDowngradeMisrate) {
    // 按 pitfall_id 分组统计
    const byPitfall: Record<string, { total: number; falsePos: number }> = {};
    for (const m of historicalMatches) {
      if (!byPitfall[m.pitfall_id]) byPitfall[m.pitfall_id] = { total: 0, falsePos: 0 };
      byPitfall[m.pitfall_id].total++;
      if (m.is_false_positive) byPitfall[m.pitfall_id].falsePos++;
    }

    for (const [pitfallId, stats] of Object.entries(byPitfall)) {
      if (stats.total > 3 && stats.falsePos / stats.total > DEFAULT_CONFIG.autoDowngradeMisrate) {
        shouldDowngrade.push(pitfallId);
      }
    }
  }

  return { rate, shouldDowngrade };
}

// ── 关键词提取 ──

function extractKeywords(description: string): string[] {
  // 简单分词 + 去停用词
  const stopWords = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  ]);

  const words = description
    .replace(/[^\w\s一-鿿]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()));

  // 返回最长的 5 个词作为关键词
  return words.sort((a, b) => b.length - a.length).slice(0, 5);
}
```

---

## 六、files/plan-file-writer.ts（计划文件持久化）

```typescript
// files/plan-file-writer.ts
// V12: 创建/维护 task_plan.md, findings.md, progress.md
// 兼容 planning-with-files 的 hook 脚本

import type { PlanDocument, ProgressEvent, TaskOrchestrationState } from '../types/memory';

interface PlanFileWriterConfig {
  directory: string;                // "./.praxis"
}

const DEFAULT_CONFIG: PlanFileWriterConfig = {
  directory: './.praxis',
};

// ── task_plan.md ──

export function renderPlanToMarkdown(plan: PlanDocument): string {
  const lines: string[] = [];

  lines.push(`# ${plan.task_name}`);
  lines.push('');
  lines.push(`> **计划来源**: ProtoTask \`${plan.task_type}\` (置信度 ${(plan.source_proto_task_confidence * 100).toFixed(0)}%)`);
  lines.push(`> **生成模式**: ${plan.generated_by === 'bootstrap' ? 'Bootstrap (零样本 LLM 通用知识)' : '累积 (基于项目历史)'}`);
  lines.push(`> **生成时间**: ${new Date(plan.created_at).toISOString()}`);
  lines.push(`> **版本**: v${plan.version}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const phase of plan.phases) {
    lines.push(`### ${phase.phase_name}`);
    lines.push(`**状态:** pending`);
    lines.push(`**预计时长:** ${phase.expected_duration}`);
    lines.push(`**入口标准:** ${phase.entry_criteria.join('; ')}`);
    lines.push(`**出口标准:** ${phase.exit_criteria.join('; ')}`);
    lines.push('');

    if (phase.common_challenges.length > 0) {
      lines.push('**⚠ 已知挑战:**');
      for (const challenge of phase.common_challenges) {
        lines.push(`  - ${challenge}`);
      }
      lines.push('');
    }

    if (phase.guidance.phase_suggestion) {
      lines.push(`**💡 建议:** ${phase.guidance.phase_suggestion}`);
      if (phase.guidance.confidence_advisory) {
        lines.push(`**📊 置信度:** ${phase.guidance.confidence_advisory}`);
      }
      lines.push('');
    }

    // Subtasks
    lines.push('**子任务:**');
    for (let i = 0; i < phase.subtasks.length; i++) {
      const subtask = phase.subtasks[i];
      const checkbox = subtask.state === 'SUBTASK_VERIFIED' ? '[x]' : '[ ]';
      lines.push(`- ${checkbox} ${subtask.subtask_name}`);
      if (subtask.pitfalls_warned.length > 0) {
        lines.push(`  ⚠ 陷阱预警: ${subtask.pitfalls_warned.length} 个`);
      }
    }
    lines.push('');

    if (phase.relevant_structures.length > 0) {
      lines.push(`**相关结构:** ${phase.relevant_structures.join(', ')}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Pitfalls 表
  if (plan.pitfalls.length > 0) {
    lines.push('## 陷阱登记表');
    lines.push('');
    lines.push('| 陷阱 | 严重度 | 影响阶段 | 缓解措施 | 历史命中 |');
    lines.push('|------|--------|---------|---------|---------|');
    for (const pitfall of plan.pitfalls) {
      lines.push(`| ${pitfall.description} | ${pitfall.severity} | ${pitfall.affected_phases.join(', ')} | ${pitfall.mitigation} | ${pitfall.hit_count} |`);
    }
    lines.push('');
  }

  // 错误表
  lines.push('## 错误记录');
  lines.push('');
  lines.push('| 时间 | 子任务 | 错误描述 | 解决方案 | 状态 |');
  lines.push('|------|--------|---------|---------|------|');
  lines.push('| - | - | - | - | - |');
  lines.push('');

  // 决策表
  lines.push('## 关键决策');
  lines.push('');
  lines.push('| 时间 | 决策 | 原因 | 影响 |');
  lines.push('|------|------|------|------|');
  lines.push('| - | - | - | - |');
  lines.push('');

  // Global criteria
  if (plan.global_criteria.length > 0) {
    lines.push('## 全局验收标准');
    lines.push('');
    for (const crit of plan.global_criteria) {
      lines.push(`- [ ] ${crit.description} (\`${crit.type}\`)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── progress.md ──

export function renderProgressToMarkdown(
  state: TaskOrchestrationState,
  events: ProgressEvent[]
): string {
  const lines: string[] = [];

  lines.push(`# Progress Log — ${state.plan?.task_name ?? state.task_id}`);
  lines.push('');
  lines.push(`**最后更新:** ${new Date(state.last_updated_at).toISOString()}`);
  lines.push(`**任务状态:** ${state.task_state}`);
  lines.push(`**当前 Phase:** ${state.current_phase_index + 1}/${state.plan?.phases.length ?? '?'}`);
  lines.push('');

  // Per-phase progress
  if (state.plan) {
    for (const phase of state.plan.phases) {
      const phaseSubtasks = state.subtasks.filter(s => s.phase_index === phase.phase_index);
      const completed = phaseSubtasks.filter(s => s.state === 'SUBTASK_VERIFIED').length;
      const total = phaseSubtasks.length;
      const progressBar = total > 0
        ? '█'.repeat(Math.round(completed / total * 10)) + '░'.repeat(10 - Math.round(completed / total * 10))
        : '░░░░░░░░░░';

      lines.push(`### ${phase.phase_name}`);
      lines.push(`- 进度: ${progressBar} ${completed}/${total}`);
      lines.push(`- 状态: ${completed === total ? '**Status: complete**' : completed > 0 ? '**Status: in_progress**' : '**Status: pending**'}`);
      lines.push('');
    }
  }

  // Active pitfalls
  if (state.active_pitfalls.length > 0) {
    lines.push('## 活跃陷阱');
    lines.push('');
    for (const ap of state.active_pitfalls) {
      const resolved = ap.resolved ? '✅' : '⚠';
      lines.push(`- ${resolved} ${ap.evidence} (子任务: ${ap.subtask_id})`);
    }
    lines.push('');
  }

  // Recent events
  const recentEvents = [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
  if (recentEvents.length > 0) {
    lines.push('## 事件日志');
    lines.push('');
    lines.push('| 时间 | 类型 | 描述 |');
    lines.push('|------|------|------|');
    for (const event of recentEvents) {
      const time = new Date(event.timestamp).toISOString().slice(11, 19);
      lines.push(`| ${time} | ${event.event_type} | ${event.description} |`);
    }
    lines.push('');
  }

  // 5-question reboot check (planning-with-files 兼容)
  lines.push('## 恢复检查 (如果会话中断)');
  lines.push('');
  lines.push('1. 最后完成的是哪个子任务？');
  lines.push('2. 是否有未保存的更改？运行 `git status`');
  lines.push('3. 当前活跃的陷阱是什么？');
  lines.push('4. 下一步应该做什么？（检查上面的 Phase 进度）');
  lines.push('5. 是否有需要重做的失败子任务？');
  lines.push('');

  return lines.join('\n');
}

// ── findings.md ──

export function renderFindingsToMarkdown(
  subtaskName: string,
  findings: string[]
): string {
  const lines: string[] = [];

  lines.push(`# Findings — ${subtaskName}`);
  lines.push('');
  lines.push(`**记录时间:** ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## 发现');
  lines.push('');
  for (let i = 0; i < findings.length; i++) {
    lines.push(`${i + 1}. ${findings[i]}`);
  }
  lines.push('');

  return lines.join('\n');
}
```

---

## 七、修改的模块（V11 → V12 升级）

### 7.1 hooks/session-start.ts（修改）

```typescript
// hooks/session-start.ts (V12 修改 — 增量 ~30 行)

// V11: 加载 ProtoTask + TaskContext + generateGuidanceSignals()
// V12: 加载 TaskOrchestrationState + 调用 plan-generator + 注入计划上下文

import { advanceOuterLoop, getActiveSubtask, getPhaseSubtasks, getProgressSummary } from '../orchestration/task-orchestrator';
import { generatePlan } from '../orchestration/plan-generator';
import { loadOrchestratorState, saveOrchestratorState } from '../memory/slots';

export async function onSessionStart(ctx: SessionStartContext): Promise<void> {
  // ... (V10/V11 的 全量加载 + 场景识别 + 上下文压力测量 保持不变)

  // ── V12 新增: 任务编排状态加载 ──
  let orchState = await loadOrchestratorState(ctx.taskContext?.task_id);
  
  if (!orchState && ctx.taskContext?.task_type) {
    // 首次: 创建 orchestrator state → TASK_ASSESSING
    orchState = createInitialOrchestratorState(ctx.taskContext);
    orchState = advanceOuterLoop(orchState, 'session_start', 'hook:session_start').newState;

    // 有 task_type → TASK_PLAN_GENERATING
    orchState = advanceOuterLoop(
      orchState,
      'no_plan_with_task_type',
      'hook:session_start'
    ).newState;

    // 生成计划
    const { plan, source, confidence } = await generatePlan({
      taskName: ctx.taskContext.task_name ?? ctx.taskContext.task_type,
      taskType: ctx.taskContext.task_type,
    });
    orchState.plan = plan;
    orchState = advanceOuterLoop(orchState, 'plan_generated', 'hook:session_start', { plan }).newState;

    await saveOrchestratorState(orchState);
  } else if (orchState) {
    // 恢复已有状态
    orchState = advanceOuterLoop(orchState, 'session_start', 'hook:session_start').newState;
  }

  // ── V12 新增: 计划 + 进度注入到 LLM 上下文 ──
  if (orchState?.task_state === 'TASK_IN_PROGRESS') {
    const activeSubtask = getActiveSubtask(orchState);
    const phaseSubtasks = getPhaseSubtasks(orchState);
    const progressSummary = getProgressSummary(orchState);

    // 注入 Layer 1: 任务编排状态
    ctx.injectToPrompt('layer_1', buildOrchestrationPrompt(
      orchState, activeSubtask, phaseSubtasks, progressSummary
    ));
  }

  // ... (V10/V11 的 Layer 2 注入保持不变)
}

function buildOrchestrationPrompt(
  state: TaskOrchestrationState,
  activeSubtask: SubtaskDefinition | null,
  phaseSubtasks: SubtaskDefinition[],
  progressSummary: string
): string {
  const lines: string[] = [];
  lines.push('## 任务编排状态 [Praxis V12]');
  lines.push('');
  lines.push(progressSummary);

  if (activeSubtask) {
    lines.push('');
    lines.push(`### 当前子任务: ${activeSubtask.subtask_name}`);
    lines.push(activeSubtask.description);

    if (activeSubtask.pitfalls_warned.length > 0) {
      lines.push('');
      lines.push('⚠ **陷阱预警:**');
      const activePitfalls = state.active_pitfalls.filter(
        ap => activeSubtask.pitfalls_warned.includes(ap.pitfall_id)
      );
      for (const ap of activePitfalls) {
        lines.push(`  - ${ap.evidence}`);
      }
    }

    if (activeSubtask.completion_criteria.length > 0) {
      lines.push('');
      lines.push('**验收标准:**');
      for (const crit of activeSubtask.completion_criteria) {
        lines.push(`  - [ ] ${crit.description}`);
      }
    }
  }

  if (phaseSubtasks.length > 1) {
    lines.push('');
    lines.push('### 当前阶段子任务');
    for (const st of phaseSubtasks) {
      const icon = st.state === 'SUBTASK_VERIFIED' ? '✅' :
                   st.state === 'SUBTASK_ACTIVE' ? '🔄' :
                   st.state === 'SUBTASK_FAILED' ? '❌' : '📋';
      lines.push(`  - ${icon} ${st.subtask_name}`);
    }
  }

  return lines.join('\n');
}
```

### 7.2 hooks/session-end.ts（修改）

```typescript
// hooks/session-end.ts (V12 修改 — 增量 ~40 行)

// V11: processOutcomeFeedback() + outcome-weighted 更新
// V12: verifier + pitfall-tracker + processSubtaskOutcome + 持久化 + 外循环推进

import { advanceOuterLoop, isAllSubtasksDone, isPhaseComplete,
         processSubtaskOutcome } from '../orchestration/task-orchestrator';
import { verifyCompletion } from '../orchestration/verifier';
import { matchToKnownPitfalls, updateProtoTaskPitfallObservations } from '../analysis/pitfall-tracker';
import { recordEvent, generateSummary } from '../orchestration/progress-tracker';
import { renderProgressToMarkdown } from '../files/plan-file-writer';
import { saveOrchestratorState, loadProgressLog } from '../memory/slots';

export async function onSessionEnd(ctx: SessionEndContext): Promise<void> {
  // ... (V10/V11 的 持久化结构 + 一致性检查 + 遥测 保持不变)

  // ── V12 新增: 验收 + 陷阱处理 ──
  const orchState = await loadOrchestratorState(ctx.taskId);
  if (!orchState || orchState.task_state !== 'TASK_IN_PROGRESS') return;

  let progressEvents = await loadProgressLog(ctx.taskId);

  // 1. 验收所有 COMPLETING 子任务
  const completingSubtasks = orchState.subtasks.filter(s => s.state === 'SUBTASK_COMPLETING');
  for (const subtask of completingSubtasks) {
    const verificationResult = await verifyCompletion(subtask, {
      runCommand: ctx.runCommand,          // OpenClaw 提供的命令执行器
      checkFileExists: ctx.checkFileExists, // OpenClaw 提供的文件检查器
      llmEvaluator: ctx.llmComplete,       // LLM 评估器
    });

    orchState.verification_results.push(verificationResult);

    // 处理子任务结果
    const outcome = verificationResult.overall === 'verified' ? 'success' :
                    verificationResult.overall === 'needs_rework' ? 'partial_success' : 'failure';
    const result = processSubtaskOutcome(
      orchState, subtask.subtask_id, outcome, verificationResult.criteria_results
    );

    // 记录进度事件
    if (outcome === 'success') {
      progressEvents = recordEvent('subtask_completed',
        `子任务完成: ${subtask.subtask_name}`, { subtask_id: subtask.subtask_id }, progressEvents);
    } else {
      progressEvents = recordEvent('subtask_failed',
        `子任务失败: ${subtask.subtask_name}`, { subtask_id: subtask.subtask_id, outcome }, progressEvents);
    }

    progressEvents = recordEvent('verification_run',
      `验收: ${subtask.subtask_name} — ${verificationResult.overall}`, {}, progressEvents);
  }

  // 2. 陷阱匹配 (针对失败的子任务)
  const failedSubtasks = orchState.subtasks.filter(s => s.state === 'SUBTASK_FAILED');
  if (failedSubtasks.length > 0 && orchState.plan?.source_proto_task_id) {
    const protoTask = await ctx.loadProtoTask(orchState.plan.source_proto_task_id);
    if (protoTask) {
      for (const subtask of failedSubtasks) {
        const matches = matchToKnownPitfalls(subtask, protoTask);
        if (matches.length > 0) {
          updateProtoTaskPitfallObservations(protoTask, matches);
          progressEvents = recordEvent('pitfall_hit',
            `陷阱命中: ${matches.length} 个 — ${subtask.subtask_name}`,
            { subtask_id: subtask.subtask_id, matches }, progressEvents);
        }
      }
      await ctx.saveProtoTask(protoTask);
    }
  }

  // 3. 推进外循环
  if (isAllSubtasksDone(orchState)) {
    orchState = advanceOuterLoop(orchState, 'session_end_all_subtasks_done', 'hook:session_end').newState;

    if (isPhaseComplete(orchState)) {
      progressEvents = recordEvent('phase_completed',
        `Phase ${orchState.current_phase_index + 1} 完成`, {}, progressEvents);

      if (orchState.current_phase_index + 1 < (orchState.plan?.phases.length ?? 0)) {
        // 还有更多 phase → 推进
        orchState.current_phase_index++;
        orchState = advanceOuterLoop(orchState, 'all_verified_more_phases', 'hook:session_end').newState;
        progressEvents = recordEvent('phase_started',
          `Phase ${orchState.current_phase_index + 1} 开始`, {}, progressEvents);
      } else {
        // 最后一个 phase → TASK_COMPLETE
        orchState = advanceOuterLoop(orchState, 'all_verified_last_phase', 'hook:session_end').newState;
      }
    }
  }

  // 4. 持久化
  await saveOrchestratorState(orchState);
  await ctx.saveProgressLog(ctx.taskId, progressEvents);

  // 5. 写入 progress.md
  const progressMarkdown = renderProgressToMarkdown(orchState, progressEvents);
  await ctx.writeFile(`${orchState.plan_file_path}/progress.md`, progressMarkdown);
}
```

### 7.3 analysis/mid-session-learner.ts（修改）

```typescript
// analysis/mid-session-learner.ts (V12 修改 — 增量 ~50 行)

// V11: detectUserCorrection + detectToolPatternViolation → 独立置信度调整
// V12: +detectSubtaskCompletionSignal + orchestrator 事件订阅

import type { SubtaskDefinition, MidSessionContradiction, TaskOrchestrationState } from '../types/memory';
import { markSubtaskCompleting, markSubtaskBlocked } from '../orchestration/task-orchestrator';

// ── 保留 V11: 用户纠正检测 ──

const CORRECTION_PATTERNS = [
  { regex: /不对[，。！？\s]*(.{0,50})/, severity: 'moderate' as const },
  { regex: /不是这样[的]?[，。！？\s]*(.{0,50})/, severity: 'moderate' as const },
  { regex: /纠正一下[：:，。\s]*(.{0,50})/, severity: 'moderate' as const },
  { regex: /应该是[：:，。\s]*(.{0,50})/, severity: 'minor' as const },
  { regex: /实际上[：:，。\s]*(.{0,50})/, severity: 'minor' as const },
  { regex: /改了[：:，。\s]*(.{0,50})/, severity: 'minor' as const },
];

export function detectUserCorrection(
  userMessage: string,
  activeSubtask: SubtaskDefinition | null
): MidSessionContradiction[] {
  const contradictions: MidSessionContradiction[] = [];

  for (const pattern of CORRECTION_PATTERNS) {
    const match = userMessage.match(pattern.regex);
    if (match) {
      contradictions.push({
        type: 'user_correction',
        detected_at: Date.now(),
        proto_id: activeSubtask?.subtask_id ?? 'unknown',
        evidence: userMessage.slice(0, 200),
        severity: pattern.severity,
      });
    }
  }

  return contradictions;
}

// ── 保留 V11: 工具模式违反检测 ──

export function detectToolPatternViolation(
  toolName: string,
  expectedOperations: string[]
): MidSessionContradiction | null {
  const normalizedTool = toolName.toLowerCase();
  const normalizedExpected = expectedOperations.map(o => o.toLowerCase());

  if (!normalizedExpected.includes(normalizedTool)) {
    return {
      type: 'tool_mismatch',
      detected_at: Date.now(),
      proto_id: 'active_subtask',
      evidence: `工具 '${toolName}' 不在允许范围: ${expectedOperations.join(', ')}`,
      severity: 'minor',
    };
  }

  return null;
}

// ── V12 新增: 子任务完成信号检测 ──

const COMPLETION_SIGNAL_PATTERNS = [
  /写好了/,
  /完成了/,
  /做好了/,
  /实现了/,
  /通过了/,
  /done/i,
  /complete/i,
  /finished/i,
  /ready for review/i,
  /ready to test/i,
  /all tests pass/i,
  /全部测试通过/,
];

export function detectSubtaskCompletionSignal(userMessage: string): boolean {
  return COMPLETION_SIGNAL_PATTERNS.some(pattern => pattern.test(userMessage));
}

// ── V12 新增: orchestrator 事件处理 ──

export function handleMidSessionEvents(
  message: string,
  orchState: TaskOrchestrationState,
  activeSubtask: SubtaskDefinition | null
): {
  shouldBlockSubtask: boolean;
  shouldMarkCompleting: boolean;
  contradictions: MidSessionContradiction[];
} {
  const contradictions: MidSessionContradiction[] = [];
  let shouldBlockSubtask = false;
  let shouldMarkCompleting = false;

  // 1. 用户纠正检测
  const corrections = detectUserCorrection(message, activeSubtask);
  contradictions.push(...corrections);

  // 如果有 critical 纠正 → block 子任务
  if (corrections.some(c => c.severity === 'critical')) {
    shouldBlockSubtask = true;
    if (activeSubtask) {
      markSubtaskBlocked(orchState, activeSubtask.subtask_id, 'user_correction', message);
    }
  }

  // 2. 完成信号检测
  if (detectSubtaskCompletionSignal(message) && activeSubtask?.state === 'SUBTASK_ACTIVE') {
    shouldMarkCompleting = true;
    markSubtaskCompleting(orchState, activeSubtask.subtask_id);
  }

  return { shouldBlockSubtask, shouldMarkCompleting, contradictions };
}
```

### 7.4 analysis/proto-task.ts（修改）

```typescript
// analysis/proto-task.ts (V12 修改 — 增量 ~30 行)

// V11: bootstrap + 累积构造
// V12: +pitfall 命中反馈

import type { ProtoTask, PitfallMatch } from '../types/memory';

// ... (V11 的 bootstrapProtoTask + constructProtoTask + calculateProtoTaskConfidence 保持不变)

// ── V12 新增: pitfall 命中反馈 ──

export function recordPitfallHit(
  protoTask: ProtoTask,
  pitfallDescription: string,
  taskId: string,
  subtaskId: string
): ProtoTask {
  const pitfallId = pitfallDescription.slice(0, 32).replace(/\s+/g, '_').toLowerCase();

  // 查找匹配的陷阱
  const pitfall = protoTask.common_pitfalls.find(
    p => p.description.slice(0, 32).replace(/\s+/g, '_').toLowerCase() === pitfallId
  );

  if (pitfall) {
    // 陷阱命中 → 略微提升 ProtoTask 置信度 (陷阱预测被验证为有效)
    // 注意: 这是"陷阱预警对了"的信号，表示 ProtoTask 对这类任务的理解在加深
    protoTask.confidence_trend.push({
      after_observation: protoTask.observations_count,
      confidence: Math.min(protoTask.confidence + 0.02, 0.95),
      timestamp: Date.now(),
    });
    protoTask.confidence = Math.min(protoTask.confidence + 0.02, 0.95);
  }

  // 将 task_id 添加到 source_tasks (如果不在列表中)
  if (!protoTask.source_tasks.includes(taskId)) {
    protoTask.source_tasks.push(taskId);
  }

  protoTask.last_updated_at = Date.now();

  return protoTask;
}

// ── V12 新增: pitfall 命中率作为置信度信号 ──

export function calculatePitfallAccuracySignal(protoTask: ProtoTask): number {
  // 陷阱命中率 = 在最近 N 次任务中，预警的陷阱有多少实际命中
  // 命中率高 → ProtoTask 的陷阱预测能力强 → 可以作为额外的置信度加分
  const recentTasks = protoTask.source_tasks.slice(-5);
  if (recentTasks.length < 2) return 0;

  // 简化: 使用 confidence_trend 中有 pitfall 相关记录的频率
  const pitfallRelatedTrends = protoTask.confidence_trend.filter(
    t => t.after_observation > 0 && t.confidence > protoTask.confidence - 0.1
  );

  if (pitfallRelatedTrends.length === 0) return 0;

  // 命中率作为 0-1 的信号
  const signalStrength = Math.min(pitfallRelatedTrends.length / protoTask.observations_count, 1.0);
  return signalStrength * 0.05; // 最多 +0.05 置信度
}
```

### 7.5 orchestration/confidence-fuser.ts（修改）

```typescript
// orchestration/confidence-fuser.ts (V12 修改 — 增量 ~15 行)

// V11: 7 源融合 (statistical, role_verifier, concept_verifier,
//       llm_marker, user_correction, outcome_feedback, mid_session)
// V12: outcome_feedback → task_outcome (重命名 + 内部化)

const FUSION_WEIGHTS_V12 = {
  statistical:        0.25,
  role_verifier:      0.12,
  concept_verifier:   0.08,
  llm_marker:         0.25,
  user_correction:    0.12,
  task_outcome:       0.10,  // [V12] 从 outcome_feedback 重命名
  mid_session:        0.08,
};

interface ConfidenceSignals {
  statistical: number;
  role_verifier: number;
  concept_verifier: number;
  llm_marker: number;
  user_correction: number;
  task_outcome: number;      // [V12] 从 outcome_feedback 重命名，值由 task-orchestrator 内部提供
  mid_session: number;
}

export function fuseConfidence(
  signals: ConfidenceSignals
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(FUSION_WEIGHTS_V12)) {
    const signalValue = signals[key as keyof ConfidenceSignals];
    if (signalValue !== undefined && signalValue !== null) {
      weightedSum += signalValue * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
}

// ── V12 新增: task_outcome 信号计算 ──

export function calculateTaskOutcomeSignal(
  completedSubtasks: number,
  failedSubtasks: number,
  totalPitfallsHit: number
): number {
  if (completedSubtasks + failedSubtasks === 0) return 0.5; // 无数据 → 中性

  const successRatio = completedSubtasks / (completedSubtasks + failedSubtasks);

  // 成功率高 → 信号接近 1.0 (结构有效)
  // 成功率低 → 信号接近 0.0 (结构有问题)
  // 陷阱命中多 → 结构对风险的理解准确 → 略微正向
  const pitfallBonus = Math.min(totalPitfallsHit * 0.02, 0.1);
  return Math.min(successRatio + pitfallBonus, 1.0);
}
```

---

## 八、V11 移除的模块功能对照

```
V11 模块                      删除后功能在 V12 中的位置
─────────────────────────────────────────────────────────────
api/knowledge-query.ts        → plan-generator.ts: getProtoTaskTemplate()
  queryKnowledge({              (内部函数，同进程调用)
    query_type: "proto_task"    
  })                            

orchestration/cognitive-      → plan-generator.ts: PhaseGuidance
  guidance.ts                    (嵌入 PlanDocument.phases[].guidance)
  generateGuidanceSignals()     → plan-file-writer.ts: renderPlanToMarkdown()
  GuidanceSignal 格式化          (自然语言版本在 markdown 中)

analysis/outcome-feedback.ts  → task-orchestrator.ts: processSubtaskOutcome()
  processOutcomeFeedback()      (编排器内部处理子任务结果)
  置信度调整 (±0.05)           → confidence-fuser.ts: calculateTaskOutcomeSignal()
                                (信号源从外部 API 变为内部计算)
```

---

## 九、整体代码量估算

| 模块 | 预估行数 | 说明 |
|------|---------|------|
| task-orchestrator.ts | ~200 | 状态机 + 转移表 + 循环操作 |
| plan-generator.ts | ~150 | ProtoTask → PlanDocument + bootstrap |
| verifier.ts | ~120 | 5 种验收标准 + 安全检查 |
| progress-tracker.ts | ~80 | 事件记录 + 摘要 |
| pitfall-tracker.ts | ~100 | 陷阱匹配 + 反馈 + 误报控制 |
| plan-file-writer.ts | ~100 | 3 种文件 markdown 渲染 |
| **新模块合计** | **~750** | |
| session-start.ts (修改) | +30 | 状态加载 + 计划注入 |
| session-end.ts (修改) | +40 | 验收 + 陷阱 + 外循环推进 |
| message-received.ts (修改) | +25 | 内层循环事件路由 |
| before-tool-call.ts (修改) | +15 | 工具范围守卫 |
| agent-end.ts (修改) | +10 | 快照保存 |
| mid-session-learner.ts (修改) | +50 | 完成信号 + orchestrator 订阅 |
| proto-task.ts (修改) | +30 | pitfall 反馈 |
| confidence-fuser.ts (修改) | +15 | task_outcome 信号源 |
| types/memory.ts (修改) | +100 | 6 个新模型, -3 移除 |
| **修改模块合计** | **~315** | |
| **总计** | **~1065** | 净增 ~750 行 (新模块) + ~315 行修改 |

---

## 兄弟文件

- [What is Praxis V12?](what-is.md) — V12 的工程定义
- [Why Praxis V12?](why.md) — 第一性原理：为什么 V11 的边界是错的
- [Who is it for?](who.md) — 三角色职责变化
- [When does it operate?](when.md) — 6 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V11 基础 + 6 新增 - 3 移除）
- [Architecture Design](design.md) — 技术规格与 API 契约
