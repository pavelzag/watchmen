import type { KubernetesObject } from "@kubernetes/client-node";

export type WatchmenKubernetesObject = KubernetesObject & Record<string, unknown>;

export type WatchmenAgentManifestInput = {
  clusterName: string;
  projectId: string;
  location: string;
  origin: string;
  namespace?: string;
  agentSecret?: string;
  binaryUrl?: string;
  binaryBaseUrl?: string;
};

const BINARY_BASE_URL = process.env.WATCHMEN_AGENT_BINARY_BASE_URL ?? "https://github.com/pavelzag/watchmen/releases/download/agent-v0.3.19";
const BINARY_URL = process.env.WATCHMEN_AGENT_BINARY_URL ?? "";
const AGENT_VERSION = process.env.WATCHMEN_AGENT_VERSION ?? "dev";

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function agentNamespace(namespace?: string): string {
  return namespace?.trim() || "watchmen";
}

export function createWatchmenAgentObjects(input: WatchmenAgentManifestInput): WatchmenKubernetesObject[] {
  const namespace = agentNamespace(input.namespace);
  const registerUrl = `${input.origin}/api/agents/k8s/register`;
  const endpoint = `${input.origin}/api/agents/events`;
  const binaryUrl = input.binaryUrl ?? BINARY_URL;
  const binaryBaseUrl = input.binaryBaseUrl ?? BINARY_BASE_URL;

  return [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: namespace,
        labels: {
          "app.kubernetes.io/name": "watchmen",
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: "watchmen-agent-secret",
        namespace,
        labels: {
          "app.kubernetes.io/name": "watchmen",
        },
      },
      type: "Opaque",
      stringData: {
        agent_secret: input.agentSecret ?? "CHANGE_ME_TO_A_RANDOM_SECRET",
      },
    },
    {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      metadata: {
        name: "watchmen-ebpf-agent",
        namespace,
        labels: {
          "app.kubernetes.io/name": "watchmen",
          "app.kubernetes.io/component": "ebpf-agent",
        },
      },
      spec: {
        selector: {
          matchLabels: {
            "app.kubernetes.io/name": "watchmen",
            "app.kubernetes.io/component": "ebpf-agent",
          },
        },
        updateStrategy: {
          type: "RollingUpdate",
        },
        template: {
          metadata: {
            labels: {
              "app.kubernetes.io/name": "watchmen",
              "app.kubernetes.io/component": "ebpf-agent",
            },
          },
          spec: {
            nodeSelector: {
              "kubernetes.io/os": "linux",
            },
            tolerations: [
              {
                operator: "Exists",
                effect: "NoSchedule",
              },
            ],
            terminationGracePeriodSeconds: 30,
            initContainers: [
              {
                name: "install",
                image: "alpine:3.20",
                command: [
                  "/bin/sh",
                  "-c",
                  `set -eu

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64 | amd64) WATCHMEN_AGENT_ARCH="amd64" ;;
  aarch64 | arm64) WATCHMEN_AGENT_ARCH="arm64" ;;
  *) echo "unsupported node architecture: $ARCH" >&2; exit 1 ;;
esac
export WATCHMEN_AGENT_ARCH
if [ -n "$WATCHMEN_AGENT_BINARY_URL" ]; then
  DOWNLOAD_URL="$WATCHMEN_AGENT_BINARY_URL"
else
  DOWNLOAD_URL="\${WATCHMEN_AGENT_BINARY_BASE_URL%/}/watchmen-ebpf-agent-linux-$WATCHMEN_AGENT_ARCH"
fi

wget -T 15 -t 2 -qO /opt/watchmen/watchmen-ebpf-agent "$DOWNLOAD_URL"
chmod 0755 /opt/watchmen/watchmen-ebpf-agent

KERNEL="$(uname -r 2>/dev/null || echo '')"

PAYLOAD='{"clusterName":"${input.clusterName}","projectId":"${input.projectId}","location":"${input.location}","nodeName":"'"$NODE_NAME"'","agentSecret":"'"$AGENT_SECRET"'","agentVersion":"${AGENT_VERSION}","kernelVersion":"'"$KERNEL"'"}'

wget -T 5 -t 1 -qO- --header="Content-Type: application/json" \\
  --post-data="$PAYLOAD" \\
  "$REGISTER_URL" 2>/dev/null || echo "registration skipped (server unreachable)"`,
                ],
                env: [
                  { name: "WATCHMEN_AGENT_BINARY_URL", value: binaryUrl },
                  { name: "WATCHMEN_AGENT_BINARY_BASE_URL", value: binaryBaseUrl },
                  {
                    name: "NODE_NAME",
                    valueFrom: {
                      fieldRef: {
                        fieldPath: "spec.nodeName",
                      },
                    },
                  },
                  { name: "REGISTER_URL", value: registerUrl },
                  {
                    name: "AGENT_SECRET",
                    valueFrom: {
                      secretKeyRef: {
                        name: "watchmen-agent-secret",
                        key: "agent_secret",
                      },
                    },
                  },
                ],
                volumeMounts: [
                  {
                    name: "opt",
                    mountPath: "/opt/watchmen",
                  },
                ],
              },
            ],
            containers: [
              {
                name: "agent",
                image: "alpine:3.20",
                command: ["/opt/watchmen/watchmen-ebpf-agent"],
                env: [
                  { name: "WATCHMEN_ENDPOINT", value: endpoint },
                  {
                    name: "WATCHMEN_AGENT_ID",
                    valueFrom: {
                      fieldRef: {
                        fieldPath: "spec.nodeName",
                      },
                    },
                  },
                  {
                    name: "WATCHMEN_AGENT_SECRET",
                    valueFrom: {
                      secretKeyRef: {
                        name: "watchmen-agent-secret",
                        key: "agent_secret",
                      },
                    },
                  },
                  { name: "WATCHMEN_VERBOSE", value: "1" },
                  { name: "WATCHMEN_SKIP_MEMLOCK", value: "1" },
                  { name: "WATCHMEN_DROP_COMM_PREFIXES", value: "watchmen-ebpf,dockerd,containerd,kubelet" },
                  { name: "WATCHMEN_DROP_PATH_PREFIXES", value: "/api/agents/events,/api/agents/k8s/register,/v1.,/_ping,/health,/readyz" },
                  { name: "WATCHMEN_SEND_RESPONSES", value: "0" },
                ],
                securityContext: {
                  privileged: true,
                },
                volumeMounts: [
                  {
                    name: "opt",
                    mountPath: "/opt/watchmen",
                    readOnly: true,
                  },
                  {
                    name: "debugfs",
                    mountPath: "/sys/kernel/debug",
                  },
                  {
                    name: "tracefs",
                    mountPath: "/sys/kernel/tracing",
                  },
                ],
                resources: {
                  requests: {
                    cpu: "10m",
                    memory: "32Mi",
                  },
                  limits: {
                    cpu: "100m",
                    memory: "128Mi",
                  },
                },
              },
            ],
            volumes: [
              {
                name: "opt",
                emptyDir: {},
              },
              {
                name: "debugfs",
                hostPath: {
                  path: "/sys/kernel/debug",
                },
              },
              {
                name: "tracefs",
                hostPath: {
                  path: "/sys/kernel/tracing",
                },
              },
            ],
          },
        },
      },
    },
  ];
}

function objectToYaml(value: unknown, depth = 0): string {
  const indent = "  ".repeat(depth);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string" && item.includes("\n")) {
        return `${indent}- |-\n${item.split("\n").map((line) => `${indent}  ${line}`).join("\n")}`;
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const nested = objectToYaml(item, depth + 1).trimStart();
        return `${indent}- ${nested}`;
      }
      return `${indent}- ${yamlScalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => {
        if (typeof v === "string" && v.includes("\n")) {
          return `${indent}${key}: |-\n${v.split("\n").map((line) => `${indent}  ${line}`).join("\n")}`;
        }
        if (v && typeof v === "object") {
          const nested = objectToYaml(v, depth + 1);
          return `${indent}${key}:\n${nested}`;
        }
        return `${indent}${key}: ${yamlScalar(v)}`;
      })
      .join("\n");
  }
  return `${indent}${yamlScalar(value)}`;
}

function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    return yamlString(value);
  }
  return yamlString(String(value ?? ""));
}

export function generateWatchmenAgentManifest(input: WatchmenAgentManifestInput): string {
  const namespace = agentNamespace(input.namespace);
  const objects = createWatchmenAgentObjects(input);
  return `# Watchmen eBPF Agent - generated for cluster "${input.clusterName}" (${input.projectId})
# Apply with: kubectl apply -f watchmen-agent-${input.clusterName}.yaml
# Agent namespace: ${namespace}
#
# WATCHMEN_BASE_URL must be reachable from inside this Kubernetes cluster.
${objects.map((obj) => `---\n${objectToYaml(obj)}`).join("\n")}\n`;
}
