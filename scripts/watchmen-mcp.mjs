#!/usr/bin/env node
import readline from "node:readline";

const WATCHMEN_URL = (process.env.WATCHMEN_URL || "http://localhost:3000").replace(/\/+$/, "");
const WATCHMEN_API_TOKEN = process.env.WATCHMEN_API_TOKEN || "";
const PROTOCOL_VERSION = "2025-03-26";

const TOOLS = [
  {
    name: "watchmen_list_open_tasks",
    description:
      "List security remediation tasks pushed from Watchmen. Filter by status (default: open,claimed,in_progress), severity, or target CLI tool.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "open, claimed, in_progress, completed, dismissed, or all" },
        severity: { type: "string", description: "critical, high, medium, low, or all" },
        tool: { type: "string", description: "opencode, claude, codex, any, or all" },
        limit: { type: "number", description: "Max tasks to return (1-100)" },
      },
    },
  },
  {
    name: "watchmen_get_task",
    description: "Fetch full details and promptMarkdown for a Watchmen task ID.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Watchmen task ID, e.g. wm_tsk_abc123" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "watchmen_claim_task",
    description: "Claim a Watchmen task or mark it in_progress.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        claimedBy: { type: "string" },
        sessionRef: { type: "string" },
        status: { type: "string", enum: ["claimed", "in_progress"] },
      },
      required: ["taskId"],
    },
  },
  {
    name: "watchmen_complete_task",
    description: "Mark a Watchmen task as completed or dismissed, optionally with a PR URL.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: ["completed", "dismissed"] },
        prUrl: { type: "string" },
        sessionRef: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "watchmen_verify_task",
    description: "Verify whether the issues in a Watchmen task are resolved against latest stored cloud snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        autoComplete: { type: "boolean" },
      },
      required: ["taskId"],
    },
  },
];

async function apiFetch(path, init = {}) {
  if (!WATCHMEN_API_TOKEN) {
    throw new Error("WATCHMEN_API_TOKEN env var is required. Generate one in Watchmen Settings -> Integrations.");
  }
  const res = await fetch(`${WATCHMEN_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WATCHMEN_API_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Watchmen API error: HTTP ${res.status}`);
  }
  return data;
}

function textResult(text, structuredContent, isError = false) {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(isError ? { isError: true } : {}),
  };
}

async function handleRequest(req) {
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return { jsonrpc: "2.0", id: req?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  if (req.method.startsWith("notifications/")) return null;

  const id = req.id ?? null;

  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: req.params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "watchmen-stdio-mcp", version: "0.9.0" },
        instructions:
          "Use watchmen_list_open_tasks to see security issues pushed from Watchmen, watchmen_get_task for full remediation details, watchmen_claim_task before making changes, and watchmen_complete_task when done.",
      },
    };
  }

  if (req.method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (req.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

  if (req.method === "tools/call") {
    const name = req.params?.name;
    const args = req.params?.arguments || {};

    try {
      if (name === "watchmen_list_open_tasks") {
        const qs = new URLSearchParams();
        if (args.status) qs.set("status", String(args.status));
        if (args.severity) qs.set("severity", String(args.severity));
        if (args.tool) qs.set("tool", String(args.tool));
        if (args.limit) qs.set("limit", String(args.limit));
        const data = await apiFetch(`/api/handoff/tasks?${qs.toString()}`);
        const tasks = data.tasks || [];
        const text = tasks.length
          ? `Found ${tasks.length} Watchmen task(s):\n` +
            tasks
              .map((t) => `- ${t.id} [${String(t.status).toUpperCase()}] (${String(t.severity).toUpperCase()}, ${t.issueCount} issues): ${t.title}`)
              .join("\n")
          : "No matching Watchmen tasks found.";
        return { jsonrpc: "2.0", id, result: textResult(text, { tasks }) };
      }

      if (name === "watchmen_get_task") {
        const taskId = String(args.taskId || "").trim();
        if (!taskId) return { jsonrpc: "2.0", id, result: textResult("Missing taskId", undefined, true) };
        const data = await apiFetch(`/api/handoff/tasks/${encodeURIComponent(taskId)}`);
        const task = data.task;
        return { jsonrpc: "2.0", id, result: textResult(task.promptMarkdown || JSON.stringify(task, null, 2), { task }) };
      }

      if (name === "watchmen_claim_task") {
        const taskId = String(args.taskId || "").trim();
        if (!taskId) return { jsonrpc: "2.0", id, result: textResult("Missing taskId", undefined, true) };
        const data = await apiFetch(`/api/handoff/tasks/${encodeURIComponent(taskId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: args.status === "claimed" ? "claimed" : "in_progress",
            ...(args.claimedBy ? { claimedBy: String(args.claimedBy) } : {}),
            ...(args.sessionRef ? { sessionRef: String(args.sessionRef) } : {}),
          }),
        });
        return { jsonrpc: "2.0", id, result: textResult(`Task ${data.task.id} marked as ${data.task.status}.`, { task: data.task }) };
      }

      if (name === "watchmen_complete_task") {
        const taskId = String(args.taskId || "").trim();
        if (!taskId) return { jsonrpc: "2.0", id, result: textResult("Missing taskId", undefined, true) };
        const data = await apiFetch(`/api/handoff/tasks/${encodeURIComponent(taskId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: args.status === "dismissed" ? "dismissed" : "completed",
            ...(args.prUrl ? { prUrl: String(args.prUrl) } : {}),
            ...(args.sessionRef ? { sessionRef: String(args.sessionRef) } : {}),
          }),
        });
        return {
          jsonrpc: "2.0",
          id,
          result: textResult(`Task ${data.task.id} marked as ${data.task.status}.`, { task: data.task }),
        };
      }

      if (name === "watchmen_verify_task") {
        const taskId = String(args.taskId || "").trim();
        if (!taskId) return { jsonrpc: "2.0", id, result: textResult("Missing taskId", undefined, true) };
        const data = await apiFetch(`/api/handoff/tasks/${encodeURIComponent(taskId)}/verify`, {
          method: "POST",
          body: JSON.stringify({
            autoComplete: typeof args.autoComplete === "boolean" ? args.autoComplete : true,
          }),
        });
        return {
          jsonrpc: "2.0",
          id,
          result: textResult(data.verification?.summary || "Verification complete.", {
            task: data.task,
            verification: data.verification,
          }),
        };
      }

      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: textResult(`Watchmen MCP error: ${err instanceof Error ? err.message : String(err)}`, undefined, true),
      };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const responses = (await Promise.all(parsed.map(handleRequest))).filter(Boolean);
      if (responses.length > 0) process.stdout.write(`${JSON.stringify(responses)}\n`);
      return;
    }
    const response = await handleRequest(parsed);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`
    );
  }
});
