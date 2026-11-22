#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_URL = (process.env.WATCHMEN_URL || "http://localhost:3000").replace(/\/+$/, "");

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg === "-h") {
      flags.help = true;
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0] || "help", args: positionals.slice(1), flags };
}

function printHelp() {
  console.log(`Watchmen CLI Runner & Watcher (v0.9.0)

Environment:
  WATCHMEN_URL         Watchmen base URL (default: http://localhost:3000)
  WATCHMEN_API_TOKEN   Personal API token (wm_...) from Settings -> Integrations
  OPENCODE_SERVER_URL  Optional running OpenCode server URL (e.g. http://127.0.0.1:4096)

Usage:
  watchmen-cli list [--status open,claimed,in_progress] [--severity critical,high] [--tool opencode|claude|codex|any] [--json]
  watchmen-cli pull <taskId> [--json]
  watchmen-cli run <taskId> --tool <opencode|claude|codex|custom> [options]
  watchmen-cli watch --tool <opencode|claude|codex|custom> [options]
  watchmen-cli verify <taskId>

Options:
  --url <url>            Override WATCHMEN_URL
  --tool <name>          CLI adapter: opencode | claude | codex | custom
  --cmd <template>       Custom shell command template (supports {{promptFile}}, {{taskId}}, {{title}})
  --opencode-url <url>   Send task to a running OpenCode HTTP server instead of spawning CLI
  --repo <path>          Target repository path (default: current working directory)
  --worktree             Run task inside an isolated git worktree (branch: watchmen/<taskId>)
  --interactive          Use interactive CLI mode for claude/codex instead of headless mode
  --verify               Run Watchmen closed-loop verification after task completes
  --interval <sec>       Poll interval in seconds for watch mode (default: 15)
  --once                 Process currently open tasks once and exit (watch mode)
  --max-tasks <n>        Max tasks to process in a single watch pass
  --dry-run              Print adapter actions without executing or mutating Watchmen state
`);
}

async function apiFetch(baseUrl, token, apiPath, init = {}) {
  if (!token) {
    throw new Error("WATCHMEN_API_TOKEN is required. Generate one in Watchmen Settings -> Integrations.");
  }
  const res = await fetch(`${baseUrl}${apiPath}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function ensureWorktree(repoDir, taskId) {
  const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const branch = `watchmen/${safeId}`;
  const worktreeRoot = path.join(repoDir, ".watchmen-worktrees");
  const worktreeDir = path.join(worktreeRoot, safeId);

  if (fs.existsSync(worktreeDir)) {
    return { worktreeDir, branch };
  }

  fs.mkdirSync(worktreeRoot, { recursive: true });
  try {
    execFileSync("git", ["-C", repoDir, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  } catch {
    throw new Error(`--worktree requires ${repoDir} to be a git repository.`);
  }

  try {
    execFileSync("git", ["-C", repoDir, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    execFileSync("git", ["-C", repoDir, "worktree", "add", worktreeDir, branch], { stdio: "inherit" });
  } catch {
    execFileSync("git", ["-C", repoDir, "worktree", "add", "-b", branch, worktreeDir], { stdio: "inherit" });
  }
  return { worktreeDir, branch };
}

function extractPrUrl(text) {
  const match = text.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/);
  return match ? match[0] : null;
}

function spawnToolProcess(cmd, args, cwd, capture = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
      env: process.env,
    });
    let output = "";
    if (capture) {
      child.stdout?.on("data", (chunk) => {
        const s = chunk.toString();
        output += s;
        process.stdout.write(s);
      });
      child.stderr?.on("data", (chunk) => {
        const s = chunk.toString();
        output += s;
        process.stderr.write(s);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

async function runViaOpenCodeServer(serverUrl, task, directory) {
  const base = serverUrl.replace(/\/+$/, "");
  const createRes = await fetch(`${base}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Watchmen ${task.id}: ${task.title}`,
      directory,
    }),
  });
  if (!createRes.ok) {
    throw new Error(`OpenCode server /session failed: HTTP ${createRes.status}`);
  }
  const session = await createRes.json();
  const sessionId = session.id || session.sessionID;
  if (!sessionId) {
    throw new Error("OpenCode server did not return a session ID.");
  }

  const msgRes = await fetch(`${base}/session/${encodeURIComponent(sessionId)}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parts: [{ type: "text", text: task.promptMarkdown }],
    }),
  });
  if (!msgRes.ok) {
    throw new Error(`OpenCode server /session/${sessionId}/message failed: HTTP ${msgRes.status}`);
  }
  const msgBody = await msgRes.text();
  return { sessionId, output: msgBody };
}

async function executeTask({ baseUrl, token, task, flags }) {
  const tool = String(flags.tool || (task.targetTool && task.targetTool !== "any" ? task.targetTool : "opencode"));
  const repoDir = path.resolve(String(flags.repo || process.cwd()));
  const useWorktree = Boolean(flags.worktree);
  const interactive = Boolean(flags.interactive);
  const dryRun = Boolean(flags["dry-run"]);
  const opencodeServerUrl = typeof flags["opencode-url"] === "string"
    ? flags["opencode-url"]
    : process.env.OPENCODE_SERVER_URL || "";

  let runCwd = repoDir;
  let sessionRef = null;

  if (useWorktree && !dryRun) {
    const wt = ensureWorktree(repoDir, task.id);
    runCwd = wt.worktreeDir;
    sessionRef = wt.branch;
  }

  const promptFile = path.join(os.tmpdir(), `watchmen-task-${task.id}.md`);
  fs.writeFileSync(promptFile, task.promptMarkdown, "utf8");

  console.log(`[watchmen-cli] Running task ${task.id} (${task.title}) via ${tool} in ${runCwd}`);

  if (dryRun) {
    console.log(`[watchmen-cli] --dry-run: prompt written to ${promptFile}`);
    return;
  }

  await apiFetch(baseUrl, token, `/api/handoff/tasks/${encodeURIComponent(task.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "in_progress",
      claimedBy: `watchmen-cli:${tool}`,
      ...(sessionRef ? { sessionRef } : {}),
    }),
  });

  let prUrl = null;
  try {
    if (tool === "opencode" && opencodeServerUrl) {
      const serverResult = await runViaOpenCodeServer(opencodeServerUrl, task, runCwd);
      sessionRef = serverResult.sessionId;
      prUrl = extractPrUrl(serverResult.output);
      console.log(`[watchmen-cli] OpenCode session ${sessionRef} finished.`);
    } else if (tool === "opencode") {
      const res = await spawnToolProcess("opencode", ["run", task.promptMarkdown], runCwd, !interactive);
      if (res.code !== 0) throw new Error(`opencode exited with code ${res.code}`);
      prUrl = extractPrUrl(res.output);
    } else if (tool === "claude") {
      const cliArgs = interactive ? [task.promptMarkdown] : ["-p", task.promptMarkdown];
      const res = await spawnToolProcess("claude", cliArgs, runCwd, !interactive);
      if (res.code !== 0) throw new Error(`claude exited with code ${res.code}`);
      prUrl = extractPrUrl(res.output);
    } else if (tool === "codex") {
      const cliArgs = interactive ? [task.promptMarkdown] : ["exec", task.promptMarkdown];
      const res = await spawnToolProcess("codex", cliArgs, runCwd, !interactive);
      if (res.code !== 0) throw new Error(`codex exited with code ${res.code}`);
      prUrl = extractPrUrl(res.output);
    } else if (tool === "custom") {
      const template = typeof flags.cmd === "string" ? flags.cmd : "";
      if (!template) throw new Error("--cmd is required when --tool custom is used.");
      const rendered = template
        .replace(/\{\{promptFile\}\}/g, promptFile)
        .replace(/\{\{taskId\}\}/g, task.id)
        .replace(/\{\{title\}\}/g, task.title.replace(/"/g, '\\"'));
      const res = await spawnToolProcess("sh", ["-c", rendered], runCwd, !interactive);
      if (res.code !== 0) throw new Error(`custom command exited with code ${res.code}`);
      prUrl = extractPrUrl(res.output);
    } else {
      throw new Error(`Unsupported --tool "${tool}". Use opencode, claude, codex, or custom.`);
    }

    await apiFetch(baseUrl, token, `/api/handoff/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        ...(prUrl ? { prUrl } : {}),
        ...(sessionRef ? { sessionRef } : {}),
      }),
    });
    console.log(`[watchmen-cli] Marked task ${task.id} as completed${prUrl ? ` (${prUrl})` : ""}.`);

    if (flags.verify) {
      const verifyData = await apiFetch(baseUrl, token, `/api/handoff/tasks/${encodeURIComponent(task.id)}/verify`, {
        method: "POST",
        body: JSON.stringify({ autoComplete: true }),
      });
      console.log(`[watchmen-cli] Verify: ${verifyData.verification?.summary}`);
    }
  } finally {
    fs.rmSync(promptFile, { force: true });
  }
}

async function main() {
  const { command, args, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || command === "help") {
    printHelp();
    return;
  }

  const baseUrl = (typeof flags.url === "string" ? flags.url : DEFAULT_URL).replace(/\/+$/, "");
  const token = process.env.WATCHMEN_API_TOKEN || "";

  if (command === "list") {
    const qs = new URLSearchParams();
    if (typeof flags.status === "string") qs.set("status", flags.status);
    if (typeof flags.severity === "string") qs.set("severity", flags.severity);
    if (typeof flags.tool === "string") qs.set("tool", flags.tool);
    const data = await apiFetch(baseUrl, token, `/api/handoff/tasks?${qs.toString()}`);
    if (flags.json) {
      console.log(JSON.stringify(data.tasks || [], null, 2));
      return;
    }
    const tasks = data.tasks || [];
    if (tasks.length === 0) {
      console.log("No matching Watchmen tasks found.");
      return;
    }
    for (const t of tasks) {
      console.log(`${t.id}\t[${t.status}]\t(${t.severity}, ${t.issueCount} issues, tool=${t.targetTool})\t${t.title}`);
    }
    return;
  }

  if (command === "pull") {
    const taskId = args[0];
    if (!taskId) throw new Error("Usage: watchmen-cli pull <taskId>");
    const data = await apiFetch(baseUrl, token, `/api/handoff/tasks/${encodeURIComponent(taskId)}`);
    if (flags.json) {
      console.log(JSON.stringify(data.task, null, 2));
    } else {
      console.log(data.task.promptMarkdown);
    }
    return;
  }

  if (command === "verify") {
    const taskId = args[0];
    if (!taskId) throw new Error("Usage: watchmen-cli verify <taskId>");
    const data = await apiFetch(baseUrl, token, `/api/handoff/tasks/${encodeURIComponent(taskId)}/verify`, {
      method: "POST",
      body: JSON.stringify({ autoComplete: true }),
    });
    console.log(JSON.stringify(data.verification, null, 2));
    return;
  }

  if (command === "run") {
    const taskId = args[0];
    if (!taskId) throw new Error("Usage: watchmen-cli run <taskId> --tool opencode|claude|codex");
    const data = await apiFetch(baseUrl, token, `/api/handoff/tasks/${encodeURIComponent(taskId)}`);
    await executeTask({ baseUrl, token, task: data.task, flags });
    return;
  }

  if (command === "watch") {
    const intervalSec = Math.max(Number(flags.interval || 15), 3);
    const maxTasks = flags["max-tasks"] ? Number(flags["max-tasks"]) : Infinity;
    let processed = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const qs = new URLSearchParams({ status: "open" });
      if (typeof flags.severity === "string") qs.set("severity", flags.severity);
      if (typeof flags.tool === "string") qs.set("tool", flags.tool);
      const data = await apiFetch(baseUrl, token, `/api/handoff/tasks?${qs.toString()}`);
      const tasks = data.tasks || [];

      for (const task of tasks) {
        if (processed >= maxTasks) break;
        await executeTask({ baseUrl, token, task, flags });
        processed += 1;
      }

      if (flags.once || processed >= maxTasks) break;
      await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
    }
    return;
  }

  throw new Error(`Unknown command "${command}". Run with --help for usage.`);
}

main().catch((err) => {
  console.error(`[watchmen-cli] Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
