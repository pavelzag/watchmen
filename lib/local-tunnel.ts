import { spawn, type ChildProcess } from "child_process";

export type TunnelProvider = "cloudflared" | "ngrok";
export type TunnelState = "idle" | "starting" | "running" | "error";

export interface LocalTunnelStatus {
  state: TunnelState;
  provider: TunnelProvider | null;
  publicUrl: string;
  pushEndpoint: string;
  port: number;
  message: string;
  availableProviders: TunnelProvider[];
  logs: string[];
}

interface LocalTunnelRuntime {
  process: ChildProcess | null;
  status: LocalTunnelStatus;
}

declare global {
  // eslint-disable-next-line no-var
  var __watchmenLocalTunnelRuntime: LocalTunnelRuntime | undefined;
}

const DEFAULT_PORT = 3019;
const MAX_LOG_LINES = 40;

function createInitialStatus(): LocalTunnelStatus {
  return {
    state: "idle",
    provider: null,
    publicUrl: "",
    pushEndpoint: "",
    port: DEFAULT_PORT,
    message: "No local test tunnel is running.",
    availableProviders: [],
    logs: [],
  };
}

function getRuntime(): LocalTunnelRuntime {
  if (!globalThis.__watchmenLocalTunnelRuntime) {
    globalThis.__watchmenLocalTunnelRuntime = {
      process: null,
      status: createInitialStatus(),
    };
  }
  return globalThis.__watchmenLocalTunnelRuntime;
}

function appendLog(runtime: LocalTunnelRuntime, line: string) {
  const trimmed = line.trim();
  if (!trimmed) return;
  runtime.status.logs = [...runtime.status.logs.slice(-(MAX_LOG_LINES - 1)), trimmed];
}

async function commandExists(command: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn("which", [command], { stdio: "ignore" });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function getAvailableProviders(): Promise<TunnelProvider[]> {
  const [hasCloudflared, hasNgrok] = await Promise.all([
    commandExists("cloudflared"),
    commandExists("ngrok"),
  ]);

  const providers: TunnelProvider[] = [];
  if (hasCloudflared) providers.push("cloudflared");
  if (hasNgrok) providers.push("ngrok");
  return providers;
}

function buildPushEndpoint(publicUrl: string): string {
  return publicUrl ? `${publicUrl.replace(/\/$/, "")}/api/ingest/gcp/pubsub` : "";
}

function getCommandForProvider(provider: TunnelProvider, port: number): { command: string; args: string[] } {
  if (provider === "cloudflared") {
    return {
      command: "cloudflared",
      args: ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
    };
  }

  return {
    command: "ngrok",
    args: ["http", String(port), "--log", "stdout"],
  };
}

function extractPublicUrl(provider: TunnelProvider, text: string): string | null {
  if (provider === "cloudflared") {
    const match = text.match(/https:\/\/[-a-zA-Z0-9.]+trycloudflare\.com/);
    return match?.[0] ?? null;
  }

  const match = text.match(/https:\/\/[^\s"]+ngrok(?:-free)?\.app/);
  return match?.[0] ?? null;
}

export async function getLocalTunnelStatus(): Promise<LocalTunnelStatus> {
  const runtime = getRuntime();
  runtime.status.availableProviders = await getAvailableProviders();
  return {
    ...runtime.status,
    logs: [...runtime.status.logs],
    availableProviders: [...runtime.status.availableProviders],
  };
}

export async function startLocalTunnel(provider?: TunnelProvider, port = DEFAULT_PORT): Promise<LocalTunnelStatus> {
  const runtime = getRuntime();
  runtime.status.availableProviders = await getAvailableProviders();

  if (runtime.process && runtime.status.state === "running") {
    return getLocalTunnelStatus();
  }

  if (runtime.process && runtime.status.state === "starting") {
    return getLocalTunnelStatus();
  }

  const selectedProvider = provider ?? runtime.status.availableProviders[0] ?? null;
  if (!selectedProvider) {
    runtime.status = {
      ...createInitialStatus(),
      state: "error",
      message: "Install cloudflared or ngrok to start a local test tunnel.",
      availableProviders: runtime.status.availableProviders,
    };
    return getLocalTunnelStatus();
  }

  const { command, args } = getCommandForProvider(selectedProvider, port);
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  runtime.process = child;
  runtime.status = {
    ...createInitialStatus(),
    state: "starting",
    provider: selectedProvider,
    port,
    availableProviders: runtime.status.availableProviders,
    message: `Starting ${selectedProvider} tunnel for local Watchmen on port ${port}...`,
  };

  const handleOutput = (chunk: Buffer | string) => {
    const text = chunk.toString();
    appendLog(runtime, text);
    const publicUrl = extractPublicUrl(selectedProvider, text);
    if (publicUrl) {
      runtime.status = {
        ...runtime.status,
        state: "running",
        publicUrl,
        pushEndpoint: buildPushEndpoint(publicUrl),
        message: `${selectedProvider} tunnel is ready.`,
      };
    }
  };

  child.stdout.on("data", handleOutput);
  child.stderr.on("data", handleOutput);

  child.on("exit", (code, signal) => {
    runtime.process = null;
    const wasRunning = runtime.status.state === "running";
    runtime.status = {
      ...runtime.status,
      state: wasRunning ? "idle" : "error",
      publicUrl: "",
      pushEndpoint: "",
      message: wasRunning
        ? "Local test tunnel stopped."
        : `Tunnel process exited before becoming ready${code !== null ? ` (code ${code})` : signal ? ` (${signal})` : ""}.`,
    };
  });

  child.on("error", (error) => {
    runtime.process = null;
    runtime.status = {
      ...runtime.status,
      state: "error",
      publicUrl: "",
      pushEndpoint: "",
      message: `Failed to start ${selectedProvider}: ${error.message}`,
    };
  });

  const startDeadline = Date.now() + 20_000;
  while (Date.now() < startDeadline) {
    if (runtime.status.state === "running" || runtime.status.state === "error") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (runtime.status.state === "starting") {
    runtime.status = {
      ...runtime.status,
      state: "error",
      message: `Timed out waiting for ${selectedProvider} to return a public URL.`,
    };
    try {
      child.kill("SIGTERM");
    } catch {}
  }

  return getLocalTunnelStatus();
}

export async function stopLocalTunnel(): Promise<LocalTunnelStatus> {
  const runtime = getRuntime();
  const child = runtime.process;
  if (!child) {
    runtime.status = {
      ...runtime.status,
      state: "idle",
      publicUrl: "",
      pushEndpoint: "",
      message: "No local test tunnel is running.",
    };
    return getLocalTunnelStatus();
  }

  const exited = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve(false);
    }, 3_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });

    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timeout);
      resolve(false);
    }
  });

  runtime.process = null;
  runtime.status = {
    ...runtime.status,
    state: "idle",
    publicUrl: "",
    pushEndpoint: "",
    message: exited ? "Local test tunnel stopped." : "Local test tunnel was force-stopped.",
  };

  return getLocalTunnelStatus();
}
