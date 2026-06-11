import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clusterName = req.nextUrl.searchParams.get("cluster") ?? "your-cluster";
  const projectId = req.nextUrl.searchParams.get("project") ?? "your-project";
  const location = req.nextUrl.searchParams.get("location") ?? "";
  const agentVersion = process.env.WATCHMEN_AGENT_VERSION ?? "dev";
  const origin = process.env.WATCHMEN_BASE_URL ?? req.nextUrl.origin;
  const registerUrl = `${origin}/api/agents/k8s/register`;
  const binaryUrl = process.env.WATCHMEN_AGENT_BINARY_URL ?? "https://github.com/pavelzag/watchmen/releases/download/agent-v0.3.19/watchmen-ebpf-agent-linux-amd64";

  const yaml = `# Watchmen eBPF Agent — generated for cluster "${clusterName}" (${projectId})
# Apply with: kubectl apply -f -
#
# Then create the agent secret:
#   kubectl create secret generic watchmen-agent-secret \\
#     --from-literal=agent_secret="$(openssl rand -hex 32)" \\
#     -n watchmen
---
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

              PAYLOAD='{"clusterName":"${clusterName}","projectId":"${projectId}","location":"${location}","nodeName":"'"$NODE_NAME"'","agentSecret":"'"$AGENT_SECRET"'","agentVersion":"${agentVersion}","kernelVersion":"'"$KERNEL"'"}'

              wget -qO- --header="Content-Type: application/json" \
                --post-data="$PAYLOAD" \
                "$REGISTER_URL" 2>/dev/null || echo "registration skipped (server unreachable)"
          env:
            - name: WATCHMEN_AGENT_BINARY_URL
              value: "${binaryUrl}"
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
              value: "${origin}/api/agents/events"
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

  return new NextResponse(yaml, {
    headers: {
      "Content-Type": "text/yaml; charset=utf-8",
      "Content-Disposition": `attachment; filename="watchmen-agent-${clusterName}.yaml"`,
    },
  });
}
