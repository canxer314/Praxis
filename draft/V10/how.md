# How does Praxis V10 work?

> V10 的核心实现：TaskContext 注入与更新、任务感知优先级排序、ProtoTask 构造（Phase 2+）。

---

## 一、TaskContext 核心模块

```typescript
// orchestration/task-context.ts

interface TaskContext {
  task_id: string;                 // "task_hospital_sys_2026"
  task_name: string;               // "构建医院管理系统"
  task_type: string | null;        // "software_project" | "research" | "writing" | null
  current_phase: string | null;    // "Phase 2: API Development"
  progress_summary: string;        // "数据模型完成, API 60% (预约挂号进行中)"
  active_subtask: string | null;   // "实现预约挂号接口"
  relevant_scenarios: string[];    // ["hospital_outpatient", "api_design"]
  started_at: number;
  last_updated_at: number;
  auto_updated: boolean;           // 本次更新是否来自 LLM 自动推断
}

// ── session_start: 加载 + 格式化注入 ──

async function loadTaskContext(): Promise<TaskContext | null> {
  return memorySlotGet('task_context').catch(() => null);
  // AgentMemory 不可用 → 返回 null (不阻塞 session_start)
}

function formatTaskContextForInjection(ctx: TaskContext): string {
  const lines: string[] = [];
  lines.push('## 当前任务');
  lines.push(`任务: ${ctx.task_name}`);
  if (ctx.current_phase) lines.push(`阶段: ${ctx.current_phase}`);
  if (ctx.progress_summary) lines.push(`进度: ${ctx.progress_summary}`);
  if (ctx.active_subtask) lines.push(`活跃子任务: ${ctx.active_subtask}`);
  if (ctx.auto_updated) lines.push('(进度由 Praxis 自动推断，可能有误)');
  return lines.join('\n');
  // 总计 ~150-250 tokens
}

// ── session_end: LLM 推断进度更新 ──

async function inferAndUpdateProgress(
  sessionTranscript: string,
  currentTaskContext: TaskContext | null,
  config: PraxisConfig
): Promise<TaskContext | null> {

  if (!config.taskContext.auto_update || !currentTaskContext) return null;

  const prompt = `
你是一个任务进度推断器。根据以下会话记录，判断任务的进度是否有变化。

## 当前任务上下文
${JSON.stringify(currentTaskContext, null, 2)}

## 本次会话记录
${sessionTranscript.slice(0, 15000)}  # 截断到 15K tokens

## 请判断
1. 任务阶段是否发生了变化？（如果当前阶段已完成，进入下一阶段）
2. 进度百分比或关键里程碑是否有更新？
3. 当前正在进行的子任务是什么？

输出 JSON:
{
  "phase_changed": true/false,
  "new_phase": "Phase 3: ..." | null,
  "progress_update": "API 80%, 预约挂号接口已完成, 开始医保对接" | null,
  "active_subtask": "..." | null,
  "relevant_scenarios": ["..."] | null,
  "confidence": 0.0-1.0
}

如果置信度 < 0.7，phase_changed 和 progress_update 都应返回 null。
`.trim();

  const result = await callLLM(prompt, {
    model: 'claude-sonnet-4-6',
    temperature: 0.1,
    maxTokens: 1000,
  });

  const inference = parseProgressInference(result);

  if (inference.confidence < config.taskContext.auto_update_confidence_threshold) {
    return null;  // 不确定 → 不更新
  }

  const updated: TaskContext = {
    ...currentTaskContext,
    current_phase: inference.new_phase ?? currentTaskContext.current_phase,
    progress_summary: inference.progress_update ?? currentTaskContext.progress_summary,
    active_subtask: inference.active_subtask ?? currentTaskContext.active_subtask,
    relevant_scenarios: inference.relevant_scenarios ?? currentTaskContext.relevant_scenarios,
    last_updated_at: Date.now(),
    auto_updated: true,
  };

  await memorySlotSet('task_context', updated);
  return updated;
}
```

---

## 二、任务感知的上下文优先级

```typescript
// orchestration/context-organizer.ts (V10 微调)

function buildTierAWithTaskPriority(
  sceneRecognition: SceneRecognitionResult,
  taskContext: TaskContext | null,
  protoStructures: ProtoStructure[],
  cognitiveStructures: CognitiveStructure[]
): string {

  const allStructures = [
    ...cognitiveStructures.filter(cs =>
      cs.applies_to.includes(sceneRecognition.scenario_id)),
    ...protoStructures.filter(p =>
      p.scenario_id === sceneRecognition.scenario_id),
  ];

  // V10: 任务感知排序
  allStructures.sort((a, b) => {
    const sceneScoreA = calculateSceneRelevance(a, sceneRecognition);
    const sceneScoreB = calculateSceneRelevance(b, sceneRecognition);

    const taskScoreA = taskContext
      ? calculateTaskRelevance(a, taskContext)
      : 0;
    const taskScoreB = taskContext
      ? calculateTaskRelevance(b, taskContext)
      : 0;

    // 场景匹配度 60% + 任务相关性 40%
    const scoreA = sceneScoreA * 0.6 + taskScoreA * 0.4;
    const scoreB = sceneScoreB * 0.6 + taskScoreB * 0.4;

    return scoreB - scoreA;
  });

  return allStructures.map(s => {
    const calibration = getConfidenceCalibration(s);

    // V10: 标记任务相关性
    const taskRelevanceNote = taskContext &&
      isTaskRelevant(s, taskContext)
      ? `[与当前任务 "${taskContext.task_name}" 相关]`
      : '';

    return `${calibration} ${taskRelevanceNote}\n${serializeStructureFull(s)}`;
  }).join('\n\n---\n\n');
}

function calculateTaskRelevance(
  structure: ProtoStructure | CognitiveStructure,
  taskContext: TaskContext
): number {
  // 如果结构的 scenario_id 在 relevant_scenarios 中 → 高相关性
  const scenarioId = (structure as any).scenario_id ??
                     (structure as any).applies_to?.[0] ?? '';

  if (taskContext.relevant_scenarios.includes(scenarioId)) {
    return 0.8 + (structure.confidence ?? 0) * 0.2;  // 0.8-1.0
  }

  // 结构名称或标签包含任务名关键字 → 中相关性
  const name = (structure.tentative_name ?? (structure as any).name ?? '').toLowerCase();
  const taskTokens = taskContext.task_name.toLowerCase().split(/\s+/);
  const tokenMatch = taskTokens.filter(t => name.includes(t)).length;
  if (tokenMatch > 0) {
    return 0.3 + tokenMatch * 0.2;
  }

  return 0;
}
```

---

## 三、ProtoTask 构造（Phase 2+）

```typescript
// analysis/proto-task.ts

interface ProtoTask {
  task_id: string;                  // "prototask_hospital_system_dev"
  task_type: string;                // "software_project"
  tentative_name: string;           // "医院系统开发模式"
  confidence: number;               // 0.0 - 1.0

  typical_phases: {
    name: string;                   // "需求分析"
    typical_duration: string;       // "2-3周"
    key_scenarios: string[];        // ["需求讨论", "需求文档"]
    relevant_structure_ids: string[]; // 该阶段最相关的认知结构
    common_challenges: string[];
  }[];

  common_pitfalls: {
    description: string;
    affected_phases: string[];
    mitigation: string;
  }[];

  observations_count: number;       // 观察到多少个同类项目
  source_tasks: string[];           // 从哪些已完成任务中归纳

  confidence_trend: {
    after_observation: number;
    confidence: number;
  }[];

  created_at: number;
  last_updated_at: number;
}

async function constructProtoTask(
  taskType: string,
  completedTasks: TaskContext[],      // 已完成的同类任务
  relatedStructures: ProtoStructure[],
  config: PraxisConfig
): Promise<ProtoTask | null> {

  if (completedTasks.length < config.protoTask.minObservations) return null;

  const prompt = `
你是 Praxis 的任务模式分析模块。以下是 ${completedTasks.length} 个已完成
的"${taskType}"类型项目的记录。请从中归纳通用的任务推进模式。

## 已完成项目记录
${completedTasks.map((t, i) => `
### 项目 ${i + 1}: ${t.task_name}
阶段演进: ${t.progress_summary}
最终状态: 完成
`).join('\n')}

## 相关认知结构
${relatedStructures.map(s =>
  `- [${(s as any).proto_type ?? 'structure'}] ${s.tentative_name}`
).join('\n')}

## 请归纳
1. 这类项目通常包含哪些阶段？每个阶段的典型时长和关键场景是什么？
2. 有哪些常见的陷阱或容易低估的部分？
3. 哪些认知结构在哪个阶段最有用？

输出 JSON: ProtoTask 格式
置信度保守: 项目数 < 5 → confidence ≤ 0.6
`.trim();

  const result = await callLLM(prompt, {
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    maxTokens: 4000,
    responseFormat: PROTO_TASK_SCHEMA,
  });

  return parseProtoTask(result, taskType, completedTasks);
}
```

---

## 四、用户命令

```typescript
// /praxis task *

async function handleTaskCommand(args: string[], context: SessionContext) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'start':
      // /praxis task start "构建医院管理系统" --type "software_project"
      const taskContext: TaskContext = {
        task_id: `task_${Date.now()}`,
        task_name: args[1],
        task_type: args.includes('--type') ? args[args.indexOf('--type') + 1] : null,
        current_phase: null,
        progress_summary: '任务已创建',
        active_subtask: null,
        relevant_scenarios: [],
        started_at: Date.now(),
        last_updated_at: Date.now(),
        auto_updated: false,
      };
      await memorySlotSet('task_context', taskContext);
      return `任务 "${taskContext.task_name}" 已创建。`;

    case 'update':
      // /praxis task update --phase "Phase 3: UI" --progress "API 完成"
      const current = await loadTaskContext();
      if (!current) return '没有活跃任务。';
      const updated = { ...current };
      if (args.includes('--phase')) updated.current_phase = args[args.indexOf('--phase') + 1];
      if (args.includes('--progress')) updated.progress_summary = args[args.indexOf('--progress') + 1];
      updated.last_updated_at = Date.now();
      updated.auto_updated = false;
      await memorySlotSet('task_context', updated);
      return '任务上下文已更新。';

    case 'status':
      const ctx = await loadTaskContext();
      if (!ctx) return '没有活跃任务。';
      return formatTaskContextForInjection(ctx);

    case 'end':
      const toEnd = await loadTaskContext();
      if (!toEnd) return '没有活跃任务。';
      await memorySave('task_history', toEnd);
      await memorySlotSet('task_context', null);
      return `任务 "${toEnd.task_name}" 已结束并归档。`;
  }
}
```

---

## 兄弟文件

- [What is Praxis V10?](what-is.md) — V10 的工程定义
- [Why Praxis V10?](why.md) — 第一性原理：为什么需要任务级认知
- [Who is it for?](who.md) — 三角色职责变化
- [When does it operate?](when.md) — 2 Phase 实现路线图
- [Where does it sit?](where.md) — 模块树（V9 基础 + 1 新增）
- [Architecture Design](design.md) — 技术规格与 API 契约
