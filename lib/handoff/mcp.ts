import type { HandoffTaskRecord, HandoffTaskStatus, HandoffTool, LastVerificationSummary } from "@/lib/handoff/tasks";

export const MCP_PROTOCOL_VERSION = "2025-03-26";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpTaskClient {
  listTasks(params: {
    status?: string;
    severity?: string;
    tool?: string;
    limit?: number;
  }): Promise<HandoffTaskRecord[]>;
  getTask(taskId: string): Promise<HandoffTaskRecord | null>;
  updateTask(params: {
    taskId: string;
    status?: HandoffTaskStatus;
    targetTool?: HandoffTool;
    prUrl?: string | null;
    sessionRef?: string | null;
    claimedBy?: string | null;
  }): Promise<HandoffTaskRecord | null>;
  verifyTask?: (params: {
    taskId: string;
    autoComplete?: boolean;
  }) => Promise<{ task: HandoffTaskRecord; verification: LastVerificationSummary } | null>;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export const WATCHMEN_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "watchmen_list_open_tasks",
    description:
      "List security remediation tasks pushed from Watchmen. Filter by status (default: open,claimed,in_progress), severity (critical,high,medium,low), or target CLI tool (opencode, claude, codex).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Comma-separated statuses: open, claimed, in_progress, completed, dismissed, or all. Defaults to open,claimed,in_progress.",
        },
        severity: {
          type: "string",
          description: "Comma-separated severities: critical, high, medium, low, or all.",
        },
        tool: {
          type: "string",
          description: "Target CLI tool filter: opencode, claude, codex, any, or all.",
        },
        limit: {
          type: "number",
          description: "Maximum number of tasks to return (1-100). Defaults to 25.",
        },
      },
    },
  },
  {
    name: "watchmen_get_task",
    description:
      "Fetch full details, affected resources, investigation notes, remediation plan, and ready-to-execute promptMarkdown for a specific Watchmen task ID.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Watchmen task ID, e.g. wm_tsk_abc123.",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "watchmen_claim_task",
    description:
      "Claim a Watchmen task or mark it in_progress so other CLI sessions know it is actively being worked on.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Watchmen task ID to claim.",
        },
        claimedBy: {
          type: "string",
          description: "Tool or session identifier claiming the task (e.g. opencode, claude-code, codex).",
        },
        sessionRef: {
          type: "string",
          description: "Optional local CLI session ID, branch name, or worktree path.",
        },
        status: {
          type: "string",
          enum: ["claimed", "in_progress"],
          description: "New status (defaults to in_progress).",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "watchmen_complete_task",
    description:
      "Mark a Watchmen task as completed or dismissed after remediation, optionally attaching the resulting pull request URL or session reference.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Watchmen task ID to complete or dismiss.",
        },
        status: {
          type: "string",
          enum: ["completed", "dismissed"],
          description: "Final task status (defaults to completed).",
        },
        prUrl: {
          type: "string",
          description: "Optional pull request or commit URL created to resolve the issues.",
        },
        sessionRef: {
          type: "string",
          description: "Optional CLI session ID or branch name.",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "watchmen_verify_task",
    description:
      "Verify whether the issues in a Watchmen task are resolved against Watchmen's latest stored cloud snapshots, and auto-complete the task if all issues are resolved.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Watchmen task ID to verify.",
        },
        autoComplete: {
          type: "boolean",
          description: "Automatically mark task completed if all issues are resolved (default: true).",
        },
      },
      required: ["taskId"],
    },
  },
];

function okResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errResult(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  };
}

function toolText(text: string, structuredContent?: unknown, isError = false) {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

function formatTaskSummaryLine(task: HandoffTaskRecord): string {
  return `- ${task.id} [${task.status.toUpperCase()}] (${task.severity.toUpperCase()}, ${task.issueCount} issue${task.issueCount === 1 ? "" : "s"}, tool=${task.targetTool}): ${task.title}`;
}

export async function handleMcpJsonRpc(
  req: JsonRpcRequest,
  client: McpTaskClient
): Promise<JsonRpcResponse | null> {
  if (!req || typeof req !== "object" || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return errResult(req?.id ?? null, -32600, "Invalid JSON-RPC 2.0 request.");
  }

  const hasId = req.id !== undefined && req.id !== null;
  const id = req.id ?? null;

  // Notifications have no id and expect no response body.
  if (req.method.startsWith("notifications/")) {
    return null;
  }

  if (req.method === "initialize") {
    const requestedVersion =
      typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : MCP_PROTOCOL_VERSION;
    return okResult(id, {
      protocolVersion: requestedVersion || MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: "watchmen",
        version: "0.9.0",
      },
      instructions:
        "Use watchmen_list_open_tasks to see security issues pushed from Watchmen, watchmen_get_task to read full remediation instructions, watchmen_claim_task before editing code, and watchmen_complete_task when done.",
    });
  }

  if (req.method === "ping") {
    return okResult(id, {});
  }

  if (req.method === "tools/list") {
    return okResult(id, { tools: WATCHMEN_MCP_TOOLS });
  }

  if (req.method === "tools/call") {
    const name = typeof req.params?.name === "string" ? req.params.name : "";
    const args =
      req.params?.arguments && typeof req.params.arguments === "object"
        ? (req.params.arguments as Record<string, unknown>)
        : {};

    try {
      if (name === "watchmen_list_open_tasks") {
        const status = typeof args.status === "string" ? args.status : "open,claimed,in_progress";
        const severity = typeof args.severity === "string" ? args.severity : "all";
        const tool = typeof args.tool === "string" ? args.tool : "all";
        const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.min(Math.max(args.limit, 1), 100) : 25;

        const tasks = await client.listTasks({ status, severity, tool, limit });
        const summary = tasks.length
          ? `Found ${tasks.length} Watchmen task(s):\n${tasks.map(formatTaskSummaryLine).join("\n")}`
          : "No matching Watchmen tasks found.";
        return okResult(id, toolText(summary, { tasks }));
      }

      if (name === "watchmen_get_task") {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
        if (!taskId) {
          return okResult(id, toolText("Missing required argument: taskId", undefined, true));
        }
        const task = await client.getTask(taskId);
        if (!task) {
          return okResult(id, toolText(`Watchmen task not found: ${taskId}`, undefined, true));
        }
        return okResult(id, toolText(task.promptMarkdown || JSON.stringify(task, null, 2), { task }));
      }

      if (name === "watchmen_claim_task") {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
        if (!taskId) {
          return okResult(id, toolText("Missing required argument: taskId", undefined, true));
        }
        const status = args.status === "claimed" ? "claimed" : "in_progress";
        const claimedBy = typeof args.claimedBy === "string" ? args.claimedBy.trim() : undefined;
        const sessionRef = typeof args.sessionRef === "string" ? args.sessionRef.trim() : undefined;

        const updated = await client.updateTask({
          taskId,
          status,
          ...(claimedBy ? { claimedBy } : {}),
          ...(sessionRef ? { sessionRef } : {}),
        });
        if (!updated) {
          return okResult(id, toolText(`Watchmen task not found: ${taskId}`, undefined, true));
        }
        return okResult(
          id,
          toolText(`Task ${updated.id} marked as ${updated.status}.`, { task: updated })
        );
      }

      if (name === "watchmen_complete_task") {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
        if (!taskId) {
          return okResult(id, toolText("Missing required argument: taskId", undefined, true));
        }
        const status = args.status === "dismissed" ? "dismissed" : "completed";
        const prUrl = typeof args.prUrl === "string" ? args.prUrl.trim() : undefined;
        const sessionRef = typeof args.sessionRef === "string" ? args.sessionRef.trim() : undefined;

        const updated = await client.updateTask({
          taskId,
          status,
          ...(prUrl ? { prUrl } : {}),
          ...(sessionRef ? { sessionRef } : {}),
        });
        if (!updated) {
          return okResult(id, toolText(`Watchmen task not found: ${taskId}`, undefined, true));
        }
        return okResult(
          id,
          toolText(
            `Task ${updated.id} marked as ${updated.status}${updated.prUrl ? ` (PR: ${updated.prUrl})` : ""}.`,
            { task: updated }
          )
        );
      }

      if (name === "watchmen_verify_task") {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
        if (!taskId) {
          return okResult(id, toolText("Missing required argument: taskId", undefined, true));
        }
        if (!client.verifyTask) {
          return okResult(id, toolText("Verification is not supported by this MCP client.", undefined, true));
        }
        const autoComplete = typeof args.autoComplete === "boolean" ? args.autoComplete : true;
        const verified = await client.verifyTask({ taskId, autoComplete });
        if (!verified) {
          return okResult(id, toolText(`Watchmen task not found: ${taskId}`, undefined, true));
        }
        return okResult(
          id,
          toolText(verified.verification.summary, {
            task: verified.task,
            verification: verified.verification,
          })
        );
      }

      return errResult(id, -32601, `Unknown tool: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return okResult(id, toolText(`Watchmen MCP error: ${msg}`, undefined, true));
    }
  }

  if (!hasId) return null;
  return errResult(id, -32601, `Method not found: ${req.method}`);
}
