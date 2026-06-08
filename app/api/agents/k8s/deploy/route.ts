import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ensureAgentInstallTables, sql } from "@/lib/db";

const BINARY_URL = process.env.WATCHMEN_AGENT_BINARY_URL ?? "https://github.com/pavelzag/watchmen/releases/download/agent-v0.1.0/watchmen-ebpf-agent-linux-amd64";
const AGENT_VERSION = process.env.WATCHMEN_AGENT_VERSION ?? "dev";

function generateManifest(clusterName: string, projectId: string, location: string, origin: string) {
  const registerUrl = `${origin}/api/agents/k8s/register`;
  const endpoint = `${origin}/api/agents/events`;

  return `---
apiVersion: v1
kind: Namespace
metadata:
  name: watchmen
  labels:
    app.kubernetes.io/name: watchmen
---
apiVersion: v1
kind: Secret
metadata:
  name: watchmen-agent-secret
  namespace: watchmen
  labels:
    app.kubernetes.io/name: watchmen
type: Opaque
stringData:
  agent_secret: "CHANGE_ME_TO_A_RANDOM_SECRET"
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: watchmen-ebpf-agent
  namespace: watchmen
  labels:
    app.kubernetes.io/name: watchmen
    app.kubernetes.io/component: ebpf-agent
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: watchmen
      app.kubernetes.io/component: ebpf-agent
  updateStrategy:
    type: RollingUpdate
  template:
    metadata:
      labels:
        app.kubernetes.io/name: watchmen
        app.kubernetes.io/component: ebpf-agent
    spec:
      nodeSelector:
        kubernetes.io/os: linux
      tolerations:
        - operator: Exists
          effect: NoSchedule
      terminationGracePeriodSeconds: 30
      initContainers:
        - name: install
          image: alpine:3.20
          command:
            - /bin/sh
            - -c
            - |
              set -eu

              wget -qO /opt/watchmen/watchmen-ebpf-agent "$WATCHMEN_AGENT_BINARY_URL"
              chmod 0755 /opt/watchmen/watchmen-ebpf-agent

              KERNEL="$(uname -r 2>/dev/null || echo '')"

              PAYLOAD='{"clusterName":"${clusterName}","projectId":"${projectId}","location":"${location}","nodeName":"'"$NODE_NAME"'","agentSecret":"'"$AGENT_SECRET"'","agentVersion":"${AGENT_VERSION}","kernelVersion":"'"$KERNEL"'"}'

              wget -qO- --header="Content-Type: application/json"                 --post-data="$PAYLOAD"                 "$REGISTER_URL" 2>/dev/null || echo "registration skipped (server unreachable)"
          env:
            - name: WATCHMEN_AGENT_BINARY_URL
              value: "${BINARY_URL}"
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
            - name: REGISTER_URL
              value: "${registerUrl}"
            - name: AGENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: watchmen-agent-secret
                  key: agent_secret
          volumeMounts:
            - name: opt
              mountPath: /opt/watchmen
      containers:
        - name: agent
          image: alpine:3.20
          command: [/opt/watchmen/watchmen-ebpf-agent]
          env:
            - name: WATCHMEN_ENDPOINT
              value: "${endpoint}"
            - name: WATCHMEN_AGENT_ID
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
            - name: WATCHMEN_AGENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: watchmen-agent-secret
                  key: agent_secret
            - name: WATCHMEN_VERBOSE
              value: "1"
          securityContext:
            privileged: true
          volumeMounts:
            - name: opt
              mountPath: /opt/watchmen
              readOnly: true
            - name: debugfs
              mountPath: /sys/kernel/debug
            - name: tracefs
              mountPath: /sys/kernel/tracing
          resources:
            requests:
              cpu: 10m
              memory: 32Mi
            limits:
              cpu: 100m
              memory: 128Mi
      volumes:
        - name: opt
          emptyDir: {}
        - name: debugfs
          hostPath:
            path: /sys/kernel/debug
        - name: tracefs
          hostPath:
            path: /sys/kernel/tracing
`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    clusterName?: string;
    projectId?: string;
    location?: string;
  };

  if (!body.clusterName || !body.projectId || !body.location) {
    return NextResponse.json({ error: "clusterName, projectId, and location are required." }, { status: 400 });
  }

  const origin = process.env.WATCHMEN_BASE_URL ?? req.nextUrl.origin;

  try {
    const secret = execSync("openssl rand -hex 32", { timeout: 5_000 }).toString().trim();
    const manifest = generateManifest(body.clusterName, body.projectId, body.location, origin)
      .replace("CHANGE_ME_TO_A_RANDOM_SECRET", secret);

    const tmpDir = mkdtempSync(join(tmpdir(), "watchmen-"));
    const manifestPath = join(tmpDir, "manifest.yaml");
    writeFileSync(manifestPath, manifest, "utf-8");

    try {
      execSync(
        `gcloud container clusters get-credentials ${body.clusterName} --region ${body.location} --project ${body.projectId} --quiet`,
        { stdio: "pipe", timeout: 30_000 }
      );
      execSync(`kubectl apply -f ${manifestPath}`, { stdio: "pipe", timeout: 60_000 });

      // Clean up stale entries from old registration formats.
      await ensureAgentInstallTables();
      await sql`
        DELETE FROM agent_hosts
        WHERE provider = 'k8s'
          AND metadata->>'clusterName' = ${body.clusterName}
          AND id LIKE 'k8s-%'
      `;

      return NextResponse.json({ ok: true });
    } finally {
      try { rmSync(tmpDir, { recursive: true }); } catch {}
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
