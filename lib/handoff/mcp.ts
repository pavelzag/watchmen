import type { HandoffTaskRecord, HandoffTaskStatus, HandoffTool, LastVerificationSummary } from "@/lib/handoff/tasks";
import type { CloudSnapshotResourceType } from "@/lib/handoff/cloud-data";
import type {
  RuntimeRequestEvent,
  RuntimeSecurityDecisionAction,
  RuntimeSecurityRule,
  RuntimeSecuritySeverity,
} from "@/lib/runtime-security";
import type { RuntimeRequestQueryFilters } from "@/lib/runtime-security-store";

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
  listRuntimeRequests?: (
    filters: RuntimeRequestQueryFilters
  ) => Promise<{ events: RuntimeRequestEvent[]; total: number; nextCursor: number | null }>;
  getRuntimeSummary?: (filters: { from?: string; to?: string }) => Promise<unknown>;
  createOrUpdateRuntimeRule?: (input: {
    id?: string;
    name?: string;
    enabled?: boolean;
    action?: RuntimeSecurityRule["action"];
    mode?: RuntimeSecurityRule["mode"];
    condition?: RuntimeSecurityRule["condition"];
    severity?: RuntimeSecuritySeverity;
    description?: string;
  }) => Promise<RuntimeSecurityRule | null>;
  getCloudSnapshot?: (options: {
    cloud?: "gcp" | "aws" | "all";
    projectId?: string;
    resourceType?: CloudSnapshotResourceType;
  }) => Promise<Record<string, unknown>>;
  listFindings?: (options: {
    cloud?: "gcp" | "aws" | "all";
    projectId?: string;
    severity?: string;
    limit?: number;
  }) => Promise<{
    gcpFetchedAt: string | null;
    awsFetchedAt: string | null;
    total: number;
    countsBySeverity: Record<string, number>;
    findings: Array<{
      id: string;
      cloud: "gcp" | "aws";
      severity: string;
      title: string;
      description: string;
      projectOrAccountId: string;
      resourceName: string;
      resourceType: string;
      remediationHint: string;
    }>;
  }>;
  listAttackPaths?: (options: {
    projectId?: string;
    severity?: string;
    limit?: number;
  }) => Promise<{
    fetchedAt: string | null;
    total: number;
    attackPaths: Array<{ id: string; severity: string; title: string; description: string }>;
  }>;
  getCompliance?: (options: {
    standard?: "soc2" | "iso27001" | "all";
    cloud?: "gcp" | "aws" | "all";
    status?: string;
  }) => Promise<Record<string, unknown>>;
  triggerGcpScan?: () => Promise<Record<string, unknown>>;
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
  {
    name: "watchmen_list_runtime_requests",
    description:
      "Query Watchmen runtime security request events by decision (allow, flagged, would_block, blocked), method, pathPrefix, severity, or ruleId.",
    inputSchema: {
      type: "object",
      properties: {
        decision: { type: "string", enum: ["allow", "flagged", "would_block", "blocked"] },
        method: { type: "string" },
        pathPrefix: { type: "string" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        ruleId: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "watchmen_get_runtime_summary",
    description:
      "Summarize Watchmen runtime request counts by decision/severity, top matched rules, and top targeted paths.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Optional ISO timestamp lower bound." },
        to: { type: "string", description: "Optional ISO timestamp upper bound." },
      },
    },
  },
  {
    name: "watchmen_upsert_runtime_rule",
    description:
      "Create or update a Watchmen runtime security rule (supports detect vs enforce mode, block/alert actions, and attack vector templates).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Provide existing rule ID to update, or omit to create a new rule." },
        name: { type: "string" },
        enabled: { type: "boolean" },
        action: { type: "string", enum: ["alert", "block", "flag", "would_block"] },
        mode: { type: "string", enum: ["detect", "enforce"] },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        condition: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [
                "method",
                "path_prefix",
                "path_regex",
                "content_type",
                "body_contains",
                "source_ip_class",
                "status_code",
                "known_attack_vector",
              ],
            },
            value: { type: "string" },
          },
          required: ["kind", "value"],
        },
        description: { type: "string" },
      },
    },
  },
  {
    name: "watchmen_get_cloud_snapshot",
    description:
      "Pull stored cloud inventory from Watchmen (GCP projects, VMs, Cloud Run services/jobs, Cloud SQL, buckets, IAM, service accounts, firewall rules, load balancers, secrets, pubsub, GKE, BigQuery, or AWS). Defaults to summary; pass resourceType to fetch full resource lists.",
    inputSchema: {
      type: "object",
      properties: {
        cloud: {
          type: "string",
          enum: ["gcp", "aws", "all"],
          description: "Cloud provider to inspect (defaults to gcp).",
        },
        projectId: {
          type: "string",
          description: "Optional GCP project ID filter (e.g. theinsite-dev or theinsite-prod).",
        },
        resourceType: {
          type: "string",
          enum: [
            "summary",
            "vms",
            "cloud_run",
            "cloud_sql",
            "buckets",
            "iam",
            "service_accounts",
            "firewall",
            "load_balancers",
            "secrets",
            "pubsub",
            "gke",
            "bigquery",
            "all",
          ],
          description: "Which inventory slice to return (defaults to summary).",
        },
      },
    },
  },
  {
    name: "watchmen_list_findings",
    description:
      "List computed security findings from Watchmen's latest stored GCP/AWS snapshots, sorted by severity.",
    inputSchema: {
      type: "object",
      properties: {
        cloud: {
          type: "string",
          enum: ["gcp", "aws", "all"],
          description: "Cloud filter (defaults to all).",
        },
        projectId: {
          type: "string",
          description: "Optional GCP project ID or AWS account ID filter.",
        },
        severity: {
          type: "string",
          description: "Comma-separated severities: critical, high, medium, low, or all (defaults to all).",
        },
        limit: {
          type: "number",
          description: "Maximum findings to return (1-200, defaults to 50).",
        },
      },
    },
  },
  {
    name: "watchmen_list_attack_paths",
    description:
      "List multi-hop GCP attack paths discovered from Watchmen's latest stored snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Optional GCP project ID filter.",
        },
        severity: {
          type: "string",
          description: "Severity filter: critical, high, or all (defaults to all).",
        },
        limit: {
          type: "number",
          description: "Maximum attack paths to return (1-100, defaults to 25).",
        },
      },
    },
  },
  {
    name: "watchmen_get_compliance",
    description:
      "Evaluate SOC 2 and ISO 27001 compliance controls and scores against Watchmen's latest stored cloud snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        standard: {
          type: "string",
          enum: ["soc2", "iso27001", "all"],
          description: "Compliance standard (defaults to all).",
        },
        cloud: {
          type: "string",
          enum: ["gcp", "aws", "all"],
          description: "Cloud provider (defaults to gcp).",
        },
        status: {
          type: "string",
          description: "Optional comma-separated control status filter: fail, warning, pass, suppressed, or all.",
        },
      },
    },
  },
  {
    name: "watchmen_trigger_scan",
    description:
      "Run a fresh live GCP cloud posture scan using Watchmen's configured credentials (keyless ADC or saved SA key), persist the snapshot, and return the updated summary.",
    inputSchema: {
      type: "object",
      properties: {},
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
        "Use watchmen_get_cloud_snapshot, watchmen_list_findings, watchmen_list_attack_paths, watchmen_get_compliance, and watchmen_trigger_scan to inspect cloud inventory and security posture, and use watchmen_list_open_tasks, watchmen_get_task, watchmen_claim_task, watchmen_complete_task, and watchmen_verify_task to remediate queued tasks.",
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

      if (name === "watchmen_list_runtime_requests") {
        if (!client.listRuntimeRequests) {
          return okResult(id, toolText("Runtime request queries are not supported by this MCP client.", undefined, true));
        }
        const data = await client.listRuntimeRequests({
          decision: typeof args.decision === "string" ? (args.decision as RuntimeSecurityDecisionAction) : undefined,
          method: typeof args.method === "string" ? args.method : undefined,
          pathPrefix: typeof args.pathPrefix === "string" ? args.pathPrefix : undefined,
          severity: typeof args.severity === "string" ? (args.severity as RuntimeSecuritySeverity) : undefined,
          ruleId: typeof args.ruleId === "string" ? args.ruleId : undefined,
          limit: typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : 25,
        });
        const text = data.events.length
          ? `Found ${data.total} runtime request(s) (showing ${data.events.length}):\n` +
            data.events
              .map((e) => `- ${e.id} [${e.decision.toUpperCase()}] ${e.method ?? "HTTP"} ${e.path ?? "/"} (status=${e.statusCode ?? "-"})`)
              .join("\n")
          : "No matching runtime requests found.";
        return okResult(id, toolText(text, data));
      }

      if (name === "watchmen_get_runtime_summary") {
        if (!client.getRuntimeSummary) {
          return okResult(id, toolText("Runtime summary is not supported by this MCP client.", undefined, true));
        }
        const summary = await client.getRuntimeSummary({
          from: typeof args.from === "string" ? args.from : undefined,
          to: typeof args.to === "string" ? args.to : undefined,
        });
        return okResult(id, toolText(JSON.stringify(summary, null, 2), { summary }));
      }

      if (name === "watchmen_upsert_runtime_rule") {
        if (!client.createOrUpdateRuntimeRule) {
          return okResult(id, toolText("Runtime rule updates are not supported by this MCP client.", undefined, true));
        }
        const rule = await client.createOrUpdateRuntimeRule({
          id: typeof args.id === "string" ? args.id : undefined,
          name: typeof args.name === "string" ? args.name : undefined,
          enabled: typeof args.enabled === "boolean" ? args.enabled : undefined,
          action: typeof args.action === "string" ? (args.action as RuntimeSecurityRule["action"]) : undefined,
          mode: typeof args.mode === "string" ? (args.mode as RuntimeSecurityRule["mode"]) : undefined,
          severity: typeof args.severity === "string" ? (args.severity as RuntimeSecuritySeverity) : undefined,
          condition:
            args.condition && typeof args.condition === "object"
              ? (args.condition as RuntimeSecurityRule["condition"])
              : undefined,
          description: typeof args.description === "string" ? args.description : undefined,
        });
        if (!rule) {
          return okResult(id, toolText("Runtime rule not found or invalid rule payload.", undefined, true));
        }
        return okResult(
          id,
          toolText(`Rule ${rule.id} (${rule.name}) saved [${rule.action}/${rule.mode ?? "detect"}].`, { rule })
        );
      }

      if (name === "watchmen_get_cloud_snapshot") {
        if (!client.getCloudSnapshot) {
          return okResult(id, toolText("Cloud snapshot queries are not supported by this MCP client.", undefined, true));
        }
        const cloud = args.cloud === "aws" || args.cloud === "all" ? args.cloud : "gcp";
        const projectId = typeof args.projectId === "string" ? args.projectId.trim() : undefined;
        const resourceType = typeof args.resourceType === "string"
          ? (args.resourceType as CloudSnapshotResourceType)
          : "summary";
        const data = await client.getCloudSnapshot({ cloud, projectId, resourceType });
        return okResult(id, toolText(JSON.stringify(data, null, 2), data));
      }

      if (name === "watchmen_list_findings") {
        if (!client.listFindings) {
          return okResult(id, toolText("Findings queries are not supported by this MCP client.", undefined, true));
        }
        const cloud = args.cloud === "gcp" || args.cloud === "aws" ? args.cloud : "all";
        const projectId = typeof args.projectId === "string" ? args.projectId.trim() : undefined;
        const severity = typeof args.severity === "string" ? args.severity : "all";
        const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : 50;
        const data = await client.listFindings({ cloud, projectId, severity, limit });
        const summary = data.findings.length
          ? `Found ${data.total} finding(s) (showing ${data.findings.length}):\n` +
            data.findings
              .map((f) => `- [${f.severity.toUpperCase()}] ${f.id} (${f.projectOrAccountId}): ${f.title} — ${f.resourceName}`)
              .join("\n")
          : "No matching findings found in stored snapshots.";
        return okResult(id, toolText(summary, data));
      }

      if (name === "watchmen_list_attack_paths") {
        if (!client.listAttackPaths) {
          return okResult(id, toolText("Attack path queries are not supported by this MCP client.", undefined, true));
        }
        const projectId = typeof args.projectId === "string" ? args.projectId.trim() : undefined;
        const severity = typeof args.severity === "string" ? args.severity : "all";
        const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : 25;
        const data = await client.listAttackPaths({ projectId, severity, limit });
        const summary = data.attackPaths.length
          ? `Found ${data.total} attack path(s) (showing ${data.attackPaths.length}):\n` +
            data.attackPaths.map((p) => `- [${p.severity.toUpperCase()}] ${p.id}: ${p.title}`).join("\n")
          : "No matching attack paths found in stored snapshots.";
        return okResult(id, toolText(summary, data));
      }

      if (name === "watchmen_get_compliance") {
        if (!client.getCompliance) {
          return okResult(id, toolText("Compliance queries are not supported by this MCP client.", undefined, true));
        }
        const standard = args.standard === "soc2" || args.standard === "iso27001" ? args.standard : "all";
        const cloud = args.cloud === "aws" || args.cloud === "all" ? args.cloud : "gcp";
        const status = typeof args.status === "string" ? args.status : "all";
        const reports = await client.getCompliance({ standard, cloud, status });
        return okResult(id, toolText(JSON.stringify(reports, null, 2), { reports }));
      }

      if (name === "watchmen_trigger_scan") {
        if (!client.triggerGcpScan) {
          return okResult(id, toolText("Cloud scanning is not supported by this MCP client.", undefined, true));
        }
        const summary = await client.triggerGcpScan();
        return okResult(id, toolText(`GCP scan completed.\n${JSON.stringify(summary, null, 2)}`, summary));
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
