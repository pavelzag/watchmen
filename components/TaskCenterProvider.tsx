"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { RemediationTarget } from "@/lib/github/remediation-targets";
import type { TfFilePatch } from "@/lib/github/terraform-remediation";
import type {
  AnyBackgroundTask,
  BackgroundTask,
  BackgroundTaskKind,
  StreamErrorEnvelope,
  StreamProgressEnvelope,
  TaskParamsMap,
  TaskProgressEvent,
  TaskResultMap,
} from "@/lib/tasks/types";

const TASK_STORAGE_KEY = "watchmen.task-center.v1";

type StreamResultEnvelope<K extends BackgroundTaskKind> = {
  type: "result";
} & TaskResultMap[K];

type StreamHeartbeatEnvelope = {
  type: "heartbeat";
  progress?: TaskProgressEvent;
};

interface TaskCenterContextValue {
  tasks: AnyBackgroundTask[];
  startGcpScan: (params?: TaskParamsMap["gcp_scan"]) => string;
  startAwsScan: (params?: TaskParamsMap["aws_scan"]) => string;
  startAttackPathAnalysis: () => string;
  startTerraformPreview: (params: TaskParamsMap["terraform_preview"]) => string;
  startTerraformPreviewBatch: (paramsList: TaskParamsMap["terraform_preview"][]) => string[];
  startTerraformPr: (params: TaskParamsMap["terraform_pr"]) => string;
  dismissTask: (taskId: string) => void;
  clearFinishedTasks: () => void;
  clearAllTasks: () => void;
}

const TaskCenterContext = createContext<TaskCenterContextValue | null>(null);

const MAX_PROGRESS_ENTRIES = 12;
const MAX_FINISHED_TASKS = 50;
const MAX_TOTAL_TASKS = 75;
const STALE_ACTIVE_TASK_MS = 2 * 60 * 60 * 1000;
const PREVIEW_BATCH_CONCURRENCY = 2;

function taskTitle(kind: BackgroundTaskKind, params: TaskParamsMap[BackgroundTaskKind]): string {
  if (kind === "gcp_scan") return "GCP Cloud Scan";
  if (kind === "aws_scan") return "AWS Cloud Scan";
  if (kind === "attack_paths") return "Attack Path Analysis";
  if (kind === "terraform_preview") return `Terraform Preview · ${(params as TaskParamsMap["terraform_preview"]).repoFullName}`;
  return `Terraform PR · ${(params as TaskParamsMap["terraform_pr"]).repoFullName}`;
}

function newTask<K extends BackgroundTaskKind>(kind: K, params: TaskParamsMap[K]): BackgroundTask<K> {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind,
    title: taskTitle(kind, params),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    progress: [],
    percent: 0,
    params,
  };
}

function isActiveTask(task: AnyBackgroundTask): boolean {
  return task.status === "running" || task.status === "queued";
}

function markStaleTask(task: AnyBackgroundTask): AnyBackgroundTask {
  if (!isActiveTask(task)) return task;
  const updatedAt = new Date(task.updatedAt).getTime();
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < STALE_ACTIVE_TASK_MS) return task;

  return {
    ...task,
    status: "failed",
    error: task.error ?? "Task was restored from an old session and is no longer running.",
  } as AnyBackgroundTask;
}

function normalizeTask(task: AnyBackgroundTask): AnyBackgroundTask {
  if (task.kind === "terraform_preview" && task.result) {
    return markStaleTask({
      ...task,
      result: {
        ...task.result,
        failures: task.result.failures ?? [],
        coveredTargetIds: task.result.coveredTargetIds ?? [],
        uncoveredTargets: task.result.uncoveredTargets ?? [],
        fullyAddressed: task.result.fullyAddressed ?? true,
        suggestedBatches: task.result.suggestedBatches ?? [],
      },
    } as AnyBackgroundTask);
  }

  if (task.kind === "terraform_pr" && task.result) {
    return markStaleTask({
      ...task,
      result: {
        ...task.result,
        failures: task.result.failures ?? [],
        coveredTargetIds: task.result.coveredTargetIds ?? [],
        uncoveredTargets: task.result.uncoveredTargets ?? [],
        fullyAddressed: task.result.fullyAddressed ?? true,
        suggestedBatches: task.result.suggestedBatches ?? [],
      },
    } as AnyBackgroundTask);
  }

  return markStaleTask(task);
}

function pruneTasks(tasks: AnyBackgroundTask[]): AnyBackgroundTask[] {
  const sorted = [...tasks].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const active = sorted.filter(isActiveTask);
  const finished = sorted.filter((task) => task.status === "completed" || task.status === "failed");
  return [...active, ...finished.slice(0, MAX_FINISHED_TASKS)].slice(0, MAX_TOTAL_TASKS);
}

async function consumeNdjson<K extends BackgroundTaskKind>(
  response: Response,
  onEvent: (event: StreamProgressEnvelope | StreamErrorEnvelope | StreamResultEnvelope<K> | StreamHeartbeatEnvelope) => void
) {
  if (!response.body) {
    throw new Error("Streaming is not available.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      onEvent(JSON.parse(trimmed) as StreamProgressEnvelope | StreamErrorEnvelope | StreamResultEnvelope<K> | StreamHeartbeatEnvelope);
    }
  }
}

export function TaskCenterProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<AnyBackgroundTask[]>([]);
  const hasHydratedRef = useRef(false);
  const previousTasksRef = useRef<AnyBackgroundTask[]>([]);

  const mergeTasks = useCallback((localTasks: AnyBackgroundTask[], remoteTasks: AnyBackgroundTask[]) => {
    const merged = new Map<string, AnyBackgroundTask>();
    for (const rawTask of [...localTasks, ...remoteTasks]) {
      const task = normalizeTask(rawTask);
      const existing = merged.get(task.id);
      if (!existing || new Date(task.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
        merged.set(task.id, task);
      }
    }
    return pruneTasks([...merged.values()]);
  }, []);

  const updateTask = useCallback((taskId: string, updater: (task: AnyBackgroundTask) => AnyBackgroundTask) => {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? updater(task) : task))
    );
  }, []);

  const enqueueTask = useCallback(<K extends BackgroundTaskKind>(
    kind: K,
    params: TaskParamsMap[K],
    runner: (
      taskId: string,
      pushProgress: (event: TaskProgressEvent) => void,
      succeed: (result: TaskResultMap[K]) => void,
      fail: (error: string) => void
    ) => Promise<void>,
    options?: { dedupe?: boolean }
  ): string => {
    if (options?.dedupe) {
      const existing = tasks.find((task) => task.kind === kind && task.status === "running");
      if (existing) return existing.id;
    }

    const task = newTask(kind, params);
    setTasks((current) => pruneTasks([task as AnyBackgroundTask, ...current]));

    const pushProgress = (event: TaskProgressEvent) => {
      updateTask(task.id, (currentTask) => ({
        ...currentTask,
        status: "running",
        updatedAt: new Date().toISOString(),
        percent: event.percent ?? currentTask.percent,
        progress: [...currentTask.progress.slice(-(MAX_PROGRESS_ENTRIES - 1)), event],
      } as AnyBackgroundTask));
    };

    const succeed = (result: TaskResultMap[K]) => {
      updateTask(task.id, (currentTask) => ({
        ...currentTask,
        status: "completed",
        updatedAt: new Date().toISOString(),
        percent: 100,
        result,
      } as AnyBackgroundTask));
    };

    const fail = (error: string) => {
      updateTask(task.id, (currentTask) => ({
        ...currentTask,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error,
      } as AnyBackgroundTask));
    };

    void runner(task.id, pushProgress, succeed, fail);
    return task.id;
  }, [tasks, updateTask]);

  const runTerraformPreviewTask = useCallback(async (
    params: TaskParamsMap["terraform_preview"],
    pushProgress: (event: TaskProgressEvent) => void,
    succeed: (result: TaskResultMap["terraform_preview"]) => void,
    fail: (error: string) => void
  ) => {
    try {
      const response = await fetch("/api/github/terraform-pr/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, stream: true }),
      });

      if (!response.ok && !response.body) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Analysis failed");
      }

      await consumeNdjson<"terraform_preview">(response, (event) => {
        if (event.type === "heartbeat") {
          if (event.progress) pushProgress(event.progress);
        } else if (event.type === "progress") pushProgress(event.progress);
        else if (event.type === "error") fail(event.error);
        else {
          const { type: _type, ...result } = event;
          succeed({ ...result, targets: params.targets, repoFullName: params.repoFullName, defaultBranch: params.defaultBranch });
        }
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Analysis failed");
    }
  }, []);

  const startGcpScan = useCallback((params: TaskParamsMap["gcp_scan"] = {}) => {
    return enqueueTask("gcp_scan", params, async (_taskId, pushProgress, succeed, fail) => {
      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...params, stream: true }),
        });

        if (!response.ok && !response.body) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? "Failed to start GCP scan");
        }

        await consumeNdjson<"gcp_scan">(response, (event) => {
          if (event.type === "heartbeat") {
            if (event.progress) pushProgress(event.progress);
          } else if (event.type === "progress") pushProgress(event.progress);
          else if (event.type === "error") fail(event.scanId ? `[api/scan:${event.scanId}] ${event.error}` : event.error);
          else {
            const { type: _type, ...result } = event;
            succeed(result);
          }
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Failed to start GCP scan");
      }
    }, { dedupe: true });
  }, [enqueueTask]);

  const startAwsScan = useCallback((params: TaskParamsMap["aws_scan"] = {}) => {
    return enqueueTask("aws_scan", params, async (_taskId, pushProgress, succeed, fail) => {
      try {
        const response = await fetch("/api/aws/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...params, stream: true }),
        });

        if (!response.ok && !response.body) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? "Failed to start AWS scan");
        }

        await consumeNdjson<"aws_scan">(response, (event) => {
          if (event.type === "heartbeat") {
            if (event.progress) pushProgress(event.progress);
          } else if (event.type === "progress") pushProgress(event.progress);
          else if (event.type === "error") fail(event.scanId ? `[api/aws/scan:${event.scanId}] ${event.error}` : event.error);
          else {
            const { type: _type, ...result } = event;
            succeed(result);
          }
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Failed to start AWS scan");
      }
    }, { dedupe: true });
  }, [enqueueTask]);

  const startAttackPathAnalysis = useCallback(() => {
    return enqueueTask("attack_paths", {}, async (_taskId, pushProgress, succeed, fail) => {
      try {
        const response = await fetch("/api/attack-paths?stream=true");
        if (!response.ok && !response.body) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? "Failed to analyze attack paths");
        }

        await consumeNdjson<"attack_paths">(response, (event) => {
          if (event.type === "heartbeat") {
            if (event.progress) pushProgress(event.progress);
          } else if (event.type === "progress") pushProgress(event.progress);
          else if (event.type === "error") fail(event.error);
          else {
            const { type: _type, ...result } = event;
            succeed(result);
          }
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Failed to analyze attack paths");
      }
    }, { dedupe: true });
  }, [enqueueTask]);

  const startTerraformPreview = useCallback((params: TaskParamsMap["terraform_preview"]) => {
    return enqueueTask("terraform_preview", params, async (_taskId, pushProgress, succeed, fail) => {
      await runTerraformPreviewTask(params, pushProgress, succeed, fail);
    });
  }, [enqueueTask, runTerraformPreviewTask]);

  const startTerraformPreviewBatch = useCallback((paramsList: TaskParamsMap["terraform_preview"][]) => {
    if (paramsList.length === 0) return [];

    const createdTasks = paramsList.map((params) => newTask("terraform_preview", params));
    setTasks((current) => pruneTasks([...createdTasks as AnyBackgroundTask[], ...current]));
    let nextIndex = 0;
    let activeCount = 0;

    const startNext = () => {
      if (nextIndex >= createdTasks.length || activeCount >= PREVIEW_BATCH_CONCURRENCY) return;
      const task = createdTasks[nextIndex++];
      activeCount += 1;

      const pushProgress = (event: TaskProgressEvent) => {
        updateTask(task.id, (currentTask) => ({
          ...currentTask,
          status: "running",
          updatedAt: new Date().toISOString(),
          percent: event.percent ?? currentTask.percent,
          progress: [...currentTask.progress.slice(-(MAX_PROGRESS_ENTRIES - 1)), event],
        } as AnyBackgroundTask));
      };

      const succeed = (result: TaskResultMap["terraform_preview"]) => {
        updateTask(task.id, (currentTask) => ({
          ...currentTask,
          status: "completed",
          updatedAt: new Date().toISOString(),
          percent: 100,
          result,
        } as AnyBackgroundTask));
      };

      const fail = (error: string) => {
        updateTask(task.id, (currentTask) => ({
          ...currentTask,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error,
        } as AnyBackgroundTask));
      };

      setTimeout(() => {
        void runTerraformPreviewTask(task.params, pushProgress, succeed, fail)
          .finally(() => {
            activeCount -= 1;
            startNext();
          });
      }, 0);
    };

    for (let index = 0; index < Math.min(PREVIEW_BATCH_CONCURRENCY, createdTasks.length); index += 1) {
      startNext();
    }

    return createdTasks.map((task) => task.id);
  }, [runTerraformPreviewTask, updateTask]);

  const startTerraformPr = useCallback((params: TaskParamsMap["terraform_pr"]) => {
    return enqueueTask("terraform_pr", params, async (_taskId, pushProgress, succeed, fail) => {
      try {
        const response = await fetch("/api/github/terraform-pr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...params, stream: true }),
        });

        if (!response.ok && !response.body) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error ?? "Failed to create PR");
        }

        await consumeNdjson<"terraform_pr">(response, (event) => {
          if (event.type === "heartbeat") {
            if (event.progress) pushProgress(event.progress);
          } else if (event.type === "progress") pushProgress(event.progress);
          else if (event.type === "error") fail(event.error);
          else {
            const { type: _type, ...result } = event;
            succeed({ ...result, repoFullName: params.repoFullName, defaultBranch: params.defaultBranch, targets: params.targets });
          }
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Failed to create PR");
      }
    });
  }, [enqueueTask]);

  const dismissTask = useCallback((taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    void fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [taskId] }),
    }).catch(() => {});
  }, []);

  const clearFinishedTasks = useCallback(() => {
    setTasks((current) => current.filter(isActiveTask));
    void fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearFinished: true }),
    }).catch(() => {});
  }, []);

  const clearAllTasks = useCallback(() => {
    setTasks([]);
    try {
      window.localStorage.removeItem(TASK_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    void fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearAll: true }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    try {
      const stored = window.localStorage.getItem(TASK_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AnyBackgroundTask[];
        if (!cancelled && Array.isArray(parsed)) setTasks(pruneTasks(parsed.map(normalizeTask)));
      }
    } catch {
      // Ignore corrupted local task cache.
    }

    void fetch("/api/tasks")
      .then((response) => response.json())
      .then((data: { tasks?: AnyBackgroundTask[] }) => {
        if (cancelled) return;
        if (!Array.isArray(data.tasks)) {
          hasHydratedRef.current = true;
          return;
        }
        setTasks((current) => mergeTasks(current, data.tasks ?? []));
        hasHydratedRef.current = true;
      })
      .catch(() => {
        hasHydratedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [mergeTasks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(pruneTasks(tasks)));
    } catch {
      // Ignore storage failures.
    }

    if (!hasHydratedRef.current) return;
    const previousTasks = previousTasksRef.current;
    const previousById = new Map(previousTasks.map((task) => [task.id, task]));
    const hasStructuralChange = previousTasks.length !== tasks.length;
    const hasTerminalTransition = tasks.some((task) => {
      const previous = previousById.get(task.id);
      if (!previous) return false;
      return previous.status !== task.status && (task.status === "completed" || task.status === "failed");
    });
    previousTasksRef.current = tasks;

    if (!hasStructuralChange && !hasTerminalTransition) {
      return;
    }

    const changedTasks = tasks.filter((task) => {
      const previous = previousById.get(task.id);
      if (!previous) return true;
      return previous.updatedAt !== task.updatedAt || previous.status !== task.status;
    });

    if (changedTasks.length === 0) {
      return;
    }

    for (const task of changedTasks) {
      const previous = previousById.get(task.id);
      if (
        previous &&
        previous.status !== "completed" &&
        task.status === "completed" &&
        task.kind === "terraform_pr" &&
        task.result?.prUrl
      ) {
        toast.success(`Pull request #${task.result.prNumber ?? ""} created`, {
          description: task.result.repoFullName,
          duration: 20_000,
          action: {
            label: "Open PR",
            onClick: () => window.open(task.result?.prUrl, "_blank", "noopener,noreferrer"),
          },
        });
      }
    }

    void fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: changedTasks }),
    }).catch(() => {});
  }, [tasks]);

  const value = useMemo<TaskCenterContextValue>(() => ({
    tasks,
    startGcpScan,
    startAwsScan,
    startAttackPathAnalysis,
    startTerraformPreview,
    startTerraformPreviewBatch,
    startTerraformPr,
    dismissTask,
    clearFinishedTasks,
    clearAllTasks,
  }), [
    tasks,
    startGcpScan,
    startAwsScan,
    startAttackPathAnalysis,
    startTerraformPreview,
    startTerraformPreviewBatch,
    startTerraformPr,
    dismissTask,
    clearFinishedTasks,
    clearAllTasks,
  ]);

  return (
    <TaskCenterContext.Provider value={value}>
      {children}
    </TaskCenterContext.Provider>
  );
}

export function useTaskCenter() {
  const context = useContext(TaskCenterContext);
  if (!context) {
    throw new Error("useTaskCenter must be used within TaskCenterProvider");
  }
  return context;
}
