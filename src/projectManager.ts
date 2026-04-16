import { Effect } from "effect";
import { extractAnswer, parseMarker, classifyFailure } from "./answerExtraction";
import { buildProviderCommand } from "./providers";
import {
  captureTargetPane,
  createDetachedSession,
  createWindow,
  killSession,
  killWindow,
  sessionExists,
  targetExists,
} from "./tmux";
import type {
  ProjectTaskHandle,
  ProjectTaskListItem,
  ProjectTaskSnapshot,
  ProjectTaskStatus,
  ProjectTmuxTaskOptions,
  Provider,
  RunPromptStage,
} from "./types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultOptions = {
  totalTimeoutMs: 120_000,
  firstOutputTimeoutMs: 15_000,
  responseTimeoutMs: 90_000,
  pollIntervalMs: 1_000,
  stableAnswerWindowMs: 3_000,
  preserveWindowOnFailure: false,
} as const;

interface ResolvedTaskOptions {
  projectId: string;
  taskId: string;
  provider: Provider;
  prompt: string;
  workspaceDir: string;
  totalTimeoutMs: number;
  firstOutputTimeoutMs: number;
  responseTimeoutMs: number;
  pollIntervalMs: number;
  stableAnswerWindowMs: number;
  preserveWindowOnFailure: boolean;
  answerValidator?: ProjectTmuxTaskOptions["answerValidator"];
}

interface ProjectSessionRecord {
  projectId: string;
  workspaceDir: string;
  sessionName: string;
}

interface TaskRecord {
  projectId: string;
  taskId: string;
  provider: Provider;
  prompt: string;
  workspaceDir: string;
  sessionName: string;
  windowName: string;
  windowTarget: string;
  marker: string;
  status: ProjectTaskStatus;
  stage: RunPromptStage;
  currentAction: string;
  lastObservation: string;
  panePreview: string;
  answerPreview: string | null;
  markerSeen: boolean;
  exitCode: number | null;
  validationError: string | null;
  errorReason: string | null;
  startedAt: number;
  updatedAt: number;
  firstOutputAt: number | null;
  finalAnswerAt: number | null;
  completedAt: number | null;
  timeoutMs: number;
  lastPaneChangeAt: number;
  resultPromise: Promise<ProjectTaskSnapshot>;
}

const sessions = new Map<string, ProjectSessionRecord>();
const tasks = new Map<string, TaskRecord>();

const makeSessionName = (projectId: string) => `project-${sanitize(projectId)}`;
const makeWindowName = (taskId: string) => `task-${sanitize(taskId)}-${Date.now().toString(36)}`;
const makeTaskKey = (projectId: string, taskId: string) => `${projectId}::${taskId}`;

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "default";
}

function taskStatusFromStage(stage: RunPromptStage): ProjectTaskStatus {
  switch (stage) {
    case "completed":
      return "completed";
    case "answer_validation_failed":
    case "tmux_start_failed":
    case "provider_process_not_started":
    case "provider_started_no_output":
    case "provider_output_started_no_final_answer":
    case "provider_exited_without_answer":
    case "provider_auth_or_init_blocked":
    case "timeout":
      return "failed";
    case "waiting_for_final_answer":
      return "running";
    default:
      return "waiting";
  }
}

function currentActionForStage(stage: RunPromptStage, markerSeen: boolean): string {
  if (stage === "starting") return "starting tmux task";
  if (stage === "waiting_for_first_output") return "waiting for provider output";
  if (stage === "waiting_for_final_answer") {
    return markerSeen ? "parsing provider completion" : "provider is still generating";
  }

  if (stage === "completed") return "task completed";
  return "task failed";
}

function toSnapshot(record: TaskRecord): ProjectTaskSnapshot {
  return {
    projectId: record.projectId,
    taskId: record.taskId,
    provider: record.provider,
    workspaceDir: record.workspaceDir,
    sessionName: record.sessionName,
    windowName: record.windowName,
    windowTarget: record.windowTarget,
    status: record.status,
    stage: record.stage,
    currentAction: record.currentAction,
    lastObservation: record.lastObservation,
    answerPreview: record.answerPreview,
    panePreview: record.panePreview,
    markerSeen: record.markerSeen,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    firstOutputAt: record.firstOutputAt,
    finalAnswerAt: record.finalAnswerAt,
    completedAt: record.completedAt,
    stalledForMs: Date.now() - record.lastPaneChangeAt,
    errorReason: record.errorReason,
    validationError: record.validationError,
  };
}

function updateRecord(record: TaskRecord, patch: Partial<TaskRecord>): void {
  Object.assign(record, patch, { updatedAt: Date.now() });
}

export const ensureProjectTmuxSession = (projectId: string, workspaceDir: string) =>
  Effect.promise(async (): Promise<ProjectSessionRecord> => {
    const existing = sessions.get(projectId);
    if (existing && (await sessionExists(existing.sessionName))) {
      return existing;
    }

    const sessionName = makeSessionName(projectId);
    const bootstrapCommand = `bash -lc ${shellQuote(`cd ${shellQuote(workspaceDir)} && exec bash`)}`;
    const created = await createDetachedSession(sessionName, bootstrapCommand);
    if (created.exitCode !== 0 && !(await sessionExists(sessionName))) {
      throw new Error(created.stderr.trim() || created.stdout.trim() || "Failed to create project tmux session.");
    }

    const record: ProjectSessionRecord = {
      projectId,
      workspaceDir,
      sessionName,
    };
    sessions.set(projectId, record);
    return record;
  });

export const submitProjectTaskToTmux = (input: ProjectTmuxTaskOptions) =>
  Effect.promise(async (): Promise<ProjectTaskHandle> => {
    const options: ResolvedTaskOptions = { ...defaultOptions, ...input };
    const taskKey = makeTaskKey(options.projectId, options.taskId);
    if (tasks.has(taskKey)) {
      throw new Error(`Task already exists: ${taskKey}`);
    }

    const session = await Effect.runPromise(ensureProjectTmuxSession(options.projectId, options.workspaceDir));
    const marker = `__WORK_HELPER_EXIT__${sanitize(options.projectId)}_${sanitize(options.taskId)}_${Date.now().toString(36)}`;
    const providerCommand = buildProviderCommand(options.provider, options.prompt, options.workspaceDir, marker);
    const windowName = makeWindowName(options.taskId);
    const created = await createWindow(session.sessionName, windowName, providerCommand.command);
    if (created.exitCode !== 0) {
      throw new Error(created.stderr.trim() || created.stdout.trim() || "Failed to create task window.");
    }

    const startedAt = Date.now();
    const record: TaskRecord = {
      projectId: options.projectId,
      taskId: options.taskId,
      provider: options.provider,
      prompt: options.prompt,
      workspaceDir: options.workspaceDir,
      sessionName: session.sessionName,
      windowName,
      windowTarget: `${session.sessionName}:${windowName}`,
      marker,
      status: "queued",
      stage: "starting",
      currentAction: "starting tmux task",
      lastObservation: "Task submitted to tmux window.",
      panePreview: "",
      answerPreview: null,
      markerSeen: false,
      exitCode: null,
      validationError: null,
      errorReason: null,
      startedAt,
      updatedAt: startedAt,
      firstOutputAt: null,
      finalAnswerAt: null,
      completedAt: null,
      timeoutMs: options.totalTimeoutMs,
      lastPaneChangeAt: startedAt,
      resultPromise: Promise.resolve(undefined as never),
    };
    tasks.set(taskKey, record);
    record.resultPromise = monitorTask(record, options);

    return {
      projectId: options.projectId,
      taskId: options.taskId,
      sessionName: record.sessionName,
      windowName: record.windowName,
      windowTarget: record.windowTarget,
      startedAt: record.startedAt,
    };
  });

async function monitorTask(record: TaskRecord, options: ResolvedTaskOptions): Promise<ProjectTaskSnapshot> {
  const startDeadline = record.startedAt + options.totalTimeoutMs;
  const firstOutputDeadline = record.startedAt + options.firstOutputTimeoutMs;
  const responseDeadline = record.startedAt + options.responseTimeoutMs;
  let lastPaneSnapshot = "";

  try {
    while (Date.now() < startDeadline) {
      const alive = await targetExists(record.windowTarget);
      const paneSnapshot = alive ? await captureTargetPane(record.windowTarget) : record.panePreview;

      if (paneSnapshot !== lastPaneSnapshot) {
        lastPaneSnapshot = paneSnapshot;
        updateRecord(record, {
          panePreview: paneSnapshot,
          lastPaneChangeAt: Date.now(),
          lastObservation: paneSnapshot.trim()
            ? `Pane updated: ${paneSnapshot.trim().split("\n").slice(-1)[0]?.slice(0, 120) ?? "output"}`
            : "Pane updated with empty output.",
        });
      }

      const parsed = parseMarker(record.panePreview, record.marker);
      const markerSeen = parsed.markerSeen;
      const exitCode = parsed.exitCode;
      const trimmed = record.panePreview.trim();
      let stage: RunPromptStage = record.stage;

      if (trimmed && record.firstOutputAt === null) {
        stage = "waiting_for_final_answer";
        updateRecord(record, {
          firstOutputAt: Date.now(),
        });
      } else if (!trimmed) {
        stage = "waiting_for_first_output";
      } else {
        stage = "waiting_for_final_answer";
      }

      const answer = extractAnswer(options.provider, options.prompt, record.panePreview, record.marker);
      updateRecord(record, {
        stage,
        status: taskStatusFromStage(stage),
        currentAction: currentActionForStage(stage, markerSeen),
        markerSeen,
        exitCode,
        answerPreview: answer,
      });

      if (answer) {
        const validationError = options.answerValidator?.(answer) ?? null;
        if (validationError) {
          if (markerSeen) {
            finishTask(record, "answer_validation_failed", validationError);
            return cleanupAndSnapshot(record, options);
          }

          updateRecord(record, {
            validationError,
            lastObservation: `Answer candidate rejected by validator: ${validationError}`,
          });
        } else if (markerSeen || Date.now() - record.lastPaneChangeAt >= options.stableAnswerWindowMs) {
          finishTask(
            record,
            "completed",
            markerSeen
              ? "The provider returned a final answer."
              : "A valid answer was captured and remained stable before provider exit.",
          );
          return cleanupAndSnapshot(record, options);
        }
      }

      if (!alive) {
        const failure = classifyFailure(record.panePreview, stage, markerSeen, alive);
        finishTask(record, failure.stage, failure.reason);
        return cleanupAndSnapshot(record, options);
      }

      if (record.firstOutputAt === null && Date.now() > firstOutputDeadline) {
        const failure = classifyFailure(record.panePreview, "waiting_for_first_output", markerSeen, alive);
        finishTask(record, failure.stage, failure.reason);
        return cleanupAndSnapshot(record, options);
      }

      if (record.firstOutputAt !== null && Date.now() > responseDeadline) {
        const failure = classifyFailure(record.panePreview, "waiting_for_final_answer", markerSeen, alive);
        finishTask(record, failure.stage, failure.reason);
        return cleanupAndSnapshot(record, options);
      }

      await sleep(options.pollIntervalMs);
    }

    finishTask(record, "timeout", "The task exceeded the configured total timeout.");
    return cleanupAndSnapshot(record, options);
  } catch (error) {
    finishTask(record, "tmux_start_failed", error instanceof Error ? error.message : String(error));
    return cleanupAndSnapshot(record, options);
  }
}

function finishTask(record: TaskRecord, stage: RunPromptStage, reason: string): void {
  const completedAt = Date.now();
  updateRecord(record, {
    stage,
    status: taskStatusFromStage(stage),
    currentAction: currentActionForStage(stage, record.markerSeen),
    errorReason: stage === "completed" ? null : reason,
    validationError: stage === "answer_validation_failed" ? reason : record.validationError,
    lastObservation: reason,
    finalAnswerAt: record.answerPreview ? completedAt : record.finalAnswerAt,
    completedAt,
  });
}

async function cleanupAndSnapshot(record: TaskRecord, options: ResolvedTaskOptions): Promise<ProjectTaskSnapshot> {
  if ((record.status === "completed" || !options.preserveWindowOnFailure) && (await targetExists(record.windowTarget))) {
    await killWindow(record.windowTarget);
  }

  return toSnapshot(record);
}

export const getProjectTaskSnapshot = (projectId: string, taskId: string) =>
  Effect.sync((): ProjectTaskSnapshot | null => {
    const record = tasks.get(makeTaskKey(projectId, taskId));
    return record ? toSnapshot(record) : null;
  });

export const listProjectTasks = (projectId?: string) =>
  Effect.sync((): ProjectTaskListItem[] =>
    [...tasks.values()]
      .filter((task) => (projectId ? task.projectId === projectId : true))
      .map((task) => toSnapshot(task)),
  );

export const waitForProjectTask = (projectId: string, taskId: string) =>
  Effect.promise(async (): Promise<ProjectTaskSnapshot> => {
    const record = tasks.get(makeTaskKey(projectId, taskId));
    if (!record) {
      throw new Error(`Task not found: ${projectId}/${taskId}`);
    }

    return record.resultPromise;
  });

export const destroyProjectTmuxSession = (projectId: string) =>
  Effect.promise(async (): Promise<void> => {
    const session = sessions.get(projectId);
    if (!session) {
      return;
    }

    await killSession(session.sessionName);
    sessions.delete(projectId);
  });

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
