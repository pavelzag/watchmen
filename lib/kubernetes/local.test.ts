jest.mock("@kubernetes/client-node", () => ({
  KubeConfig: class {},
  CoreV1Api: class {},
  AppsV1Api: class {},
  VersionApi: class {},
}));
jest.mock("@/lib/db", () => ({
  sql: jest.fn(),
}));

import {
  expandKubeconfigPath,
  normalizeKubernetesPod,
  normalizeKubernetesService,
  normalizeKubernetesWorkload,
  normalizeLocalKubernetesConfig,
  parseKubernetesLogLine,
} from "./local";

describe("local Kubernetes helpers", () => {
  it("expands kubeconfig paths safely", () => {
    expect(expandKubeconfigPath("~/.kube/config", "/home/watchmen")).toBe("/home/watchmen/.kube/config");
    expect(expandKubeconfigPath("", "/home/watchmen")).toBe("/home/watchmen/.kube/config");
    expect(expandKubeconfigPath("/tmp/kubeconfig", "/home/watchmen")).toBe("/tmp/kubeconfig");
  });

  it("normalizes config without exposing kubeconfig contents", () => {
    expect(normalizeLocalKubernetesConfig({
      enabled: true,
      kubeconfigPath: "  ~/.kube/watchmen  ",
      context: " watchmen-minikube ",
      namespace: " watchmen ",
    })).toEqual({
      enabled: true,
      kubeconfigPath: "~/.kube/watchmen",
      context: "watchmen-minikube",
      namespace: "watchmen",
    });
  });

  it("normalizes Kubernetes services including NodePort hints", () => {
    const service = normalizeKubernetesService({
      metadata: { name: "watchmen-shop-frontend", namespace: "watchmen", labels: { app: "frontend" } },
      spec: {
        type: "NodePort",
        selector: { app: "frontend" },
        clusterIP: "10.96.1.20",
        ports: [{ name: "http", protocol: "TCP", port: 80, targetPort: 8080, nodePort: 30080 }],
      },
    }, "watchmen-minikube");

    expect(service).toMatchObject({
      provider: "local_kubernetes",
      kind: "service",
      name: "watchmen-shop-frontend",
      namespace: "watchmen",
      clusterName: "watchmen-minikube",
      serviceType: "NodePort",
      selectors: { app: "frontend" },
    });
    expect(service.ports?.[0]).toMatchObject({ port: 80, targetPort: 8080, nodePort: 30080 });
    expect(service.accessHint).toContain("kubectl -n watchmen port-forward service/watchmen-shop-frontend");
  });

  it("normalizes pods and workloads", () => {
    expect(normalizeKubernetesPod({
      metadata: { name: "frontend-abc", namespace: "watchmen", labels: { app: "frontend" } },
      spec: { nodeName: "minikube", containers: [{ name: "nginx" }, { name: "app" }] },
      status: { phase: "Running", podIP: "10.244.0.12", hostIP: "192.168.49.2" },
    }, "watchmen-minikube")).toMatchObject({
      kind: "pod",
      name: "frontend-abc",
      podIP: "10.244.0.12",
      nodeName: "minikube",
      containers: ["nginx", "app"],
    });

    expect(normalizeKubernetesWorkload({
      metadata: { name: "watchmen-shop-frontend", namespace: "watchmen", labels: { app: "frontend" } },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: "frontend" } },
        template: { spec: { containers: [{ name: "nginx" }] } },
      },
      status: { readyReplicas: 1, availableReplicas: 1 },
    }, "deployment", "watchmen-minikube")).toMatchObject({
      kind: "deployment",
      selectors: { app: "frontend" },
      replicas: 2,
      readyReplicas: 1,
      containers: ["nginx"],
    });
  });

  it("parses timestamped Kubernetes log lines", () => {
    expect(parseKubernetesLogLine('2026-08-17T08:10:21.123456789Z 10.76.0.1 - - "GET / HTTP/1.1" 200')).toEqual({
      timestamp: "2026-08-17T08:10:21.123456789Z",
      message: '10.76.0.1 - - "GET / HTTP/1.1" 200',
    });
    expect(parseKubernetesLogLine("plain log line")).toEqual({ timestamp: "", message: "plain log line" });
  });
});
