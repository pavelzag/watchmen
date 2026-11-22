import { NextRequest, NextResponse } from "next/server";
import {
  getHandoffTask,
  listHandoffTasks,
  resolveHandoffActor,
  updateHandoffTask,
} from "@/lib/handoff/store";
import { verifyHandoffTask } from "@/lib/handoff/verify";
import {
  handleMcpJsonRpc,
  MCP_PROTOCOL_VERSION,
  WATCHMEN_MCP_TOOLS,
  type JsonRpcRequest,
  type McpTaskClient,
} from "@/lib/handoff/mcp";

function createServerTaskClient(userEmail: string): McpTaskClient {
  return {
    listTasks: (params) =>
      listHandoffTasks({
        userEmail,
        status: params.status,
        severity: params.severity,
        tool: params.tool,
        limit: params.limit,
      }),
    getTask: (taskId) => getHandoffTask(userEmail, taskId),
    updateTask: (params) =>
      updateHandoffTask({
        userEmail,
        taskId: params.taskId,
        status: params.status,
        targetTool: params.targetTool,
        prUrl: params.prUrl,
        sessionRef: params.sessionRef,
        claimedBy: params.claimedBy,
      }),
    verifyTask: (params) =>
      verifyHandoffTask({
        userEmail,
        taskId: params.taskId,
        autoComplete: params.autoComplete,
      }),
  };
}

export async function GET(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized. Provide Authorization: Bearer wm_..." }, { status: 401 });
  }

  return NextResponse.json({
    name: "watchmen",
    version: "0.9.0",
    transport: "streamable-http",
    protocolVersion: MCP_PROTOCOL_VERSION,
    tools: WATCHMEN_MCP_TOOLS.map((t) => t.name),
  });
}

export async function POST(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized. Provide Authorization: Bearer wm_..." },
      },
      { status: 401 }
    );
  }
  if (actor.isDemoUser) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32003, message: "Watchmen MCP queue access is disabled in Demo mode." },
      },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: invalid JSON body." },
      },
      { status: 400 }
    );
  }

  const client = createServerTaskClient(actor.email);

  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(body.map((item) => handleMcpJsonRpc(item as JsonRpcRequest, client)))
    ).filter((r) => r !== null);

    if (responses.length === 0) {
      return new NextResponse(null, { status: 202 });
    }
    return NextResponse.json(responses, {
      headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
    });
  }

  const response = await handleMcpJsonRpc(body as JsonRpcRequest, client);
  if (response === null) {
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(response, {
    headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
  });
}
