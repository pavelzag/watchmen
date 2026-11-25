import { NextRequest, NextResponse } from "next/server";
import {
  getHandoffTask,
  getHandoffTaskSummary,
  listHandoffTasks,
  resolveHandoffActor,
  updateHandoffTask,
} from "@/lib/handoff/store";
import { verifyHandoffTask } from "@/lib/handoff/verify";
import {
  getCloudSnapshotForMcp,
  getComplianceForMcp,
  listAttackPathsForMcp,
  listCloudFindingsForMcp,
  triggerGcpScanForMcp,
} from "@/lib/handoff/cloud-data";
import {
  createRuntimeSecurityRule,
  getRuntimeSecuritySummary,
  queryRuntimeRequestEvents,
  updateRuntimeSecurityRule,
} from "@/lib/runtime-security-store";
import {
  isRuntimeSecurityAction,
  isRuntimeSecurityRuleMode,
  isRuntimeSecuritySeverity,
  parseRuntimeRuleCondition,
} from "@/lib/runtime-security-validation";
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
    getTaskSummary: (params) =>
      getHandoffTaskSummary({
        userEmail,
        status: params.status,
        severity: params.severity,
        tool: params.tool,
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
    listRuntimeRequests: (filters) => queryRuntimeRequestEvents(userEmail, filters),
    getRuntimeSummary: (filters) => getRuntimeSecuritySummary(userEmail, filters),
    createOrUpdateRuntimeRule: async (input) => {
      const parsedCondition = input.condition !== undefined ? parseRuntimeRuleCondition(input.condition) : undefined;
      if (input.condition !== undefined && !parsedCondition) {
        throw new Error("Invalid runtime rule condition.");
      }
      if (input.action !== undefined && !isRuntimeSecurityAction(input.action)) {
        throw new Error("Invalid runtime rule action.");
      }
      if (input.mode !== undefined && !isRuntimeSecurityRuleMode(input.mode)) {
        throw new Error("Invalid runtime rule mode.");
      }
      if (input.severity !== undefined && !isRuntimeSecuritySeverity(input.severity)) {
        throw new Error("Invalid runtime rule severity.");
      }
      if (input.id) {
        return updateRuntimeSecurityRule(userEmail, input.id, {
          ...(input.name ? { name: input.name } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.action ? { action: input.action } : {}),
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.severity ? { severity: input.severity } : {}),
          ...(parsedCondition ? { condition: parsedCondition } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        });
      }
      if (!input.name || !input.action || !input.severity || !parsedCondition) {
        throw new Error("Creating a new rule requires name, action, severity, and condition.");
      }
      return createRuntimeSecurityRule(userEmail, {
        name: input.name,
        enabled: input.enabled ?? true,
        action: input.action,
        mode: input.mode ?? "detect",
        severity: input.severity,
        condition: parsedCondition,
        description: input.description ?? "",
      });
    },
    getCloudSnapshot: (options) => getCloudSnapshotForMcp(userEmail, options),
    listFindings: (options) => listCloudFindingsForMcp(userEmail, options),
    listAttackPaths: (options) => listAttackPathsForMcp(userEmail, options),
    getCompliance: (options) => getComplianceForMcp(userEmail, options),
    triggerGcpScan: () => triggerGcpScanForMcp(userEmail),
  };
}

export async function GET(req: NextRequest) {
  const actor = await resolveHandoffActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized. Provide Authorization: Bearer wm_..." }, { status: 401 });
  }

  return NextResponse.json({
    name: "watchmen",
    version: "0.10.0",
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
