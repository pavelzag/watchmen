# Local Kubernetes Tracing

Watchmen can read Kubernetes inventory and pod logs directly from a local kubeconfig. This is intended for minikube, kind, and other non-cloud clusters where GCP/AWS inventory and Cloud Logging are not available.

## Configuration

Open `Settings` and enable `Local Kubernetes`.

Defaults:

```bash
WATCHMEN_ENABLE_LOCAL_KUBERNETES=true
WATCHMEN_KUBECONFIG=~/.kube/config
WATCHMEN_KUBE_CONTEXT=
WATCHMEN_KUBE_NAMESPACE=watchmen
WATCHMEN_ALLOW_LOCAL_TARGETS=true
```

If `WATCHMEN_KUBE_CONTEXT` is empty, Watchmen uses the kubeconfig current context. Kubeconfig file contents are never sent to the browser; only path, context, namespace, and connection status are shown.

For production deployments, local URL proxying is blocked unless `WATCHMEN_ALLOW_LOCAL_TARGETS=true` is set. A hosted Vercel deployment also cannot reach a port-forward running on your laptop, so local Kubernetes tracing is primarily for local Watchmen development.

## Minikube Demo

The companion infrastructure repo has the demo workload:

```bash
cd ~/Projects/watchmen-infra
open MINIKUBE_SETUP.md
```

Typical context and namespace:

```bash
kubectl --context watchmen-minikube -n watchmen get pods,svc
```

The demo includes:

- `watchmen-shop-frontend` Service, NodePort
- `watchmen-shop-catalog` Service, ClusterIP
- `watchmen-shop-cart` Service, ClusterIP
- `watchmen-shop-checkout` Service, ClusterIP
- `watchmen-shop-payments` Service, ClusterIP
- `watchmen-trace-generator` Deployment

## Port Forward

Expose the frontend service locally:

```bash
kubectl --context watchmen-minikube -n watchmen port-forward service/watchmen-shop-frontend 18080:80
```

In `Trace`, select `K8S`, then send a manual request to:

```text
http://127.0.0.1:18080
```

Watchmen adds `X-Watchmen-Trace-Id`, `X-Demo-Trace-Id`, and `demo_trace_id` so nginx and app logs can be correlated.

## Generate Traffic

From this repo:

```bash
scripts/poll-minikube-watchmen-demo.sh --profile=watchmen-minikube --requests=40 --pause=0.2
```

Then keep `Trace -> K8S -> LIVE` enabled. Watchmen polls `/api/kubernetes/local/logs`, which reads pod logs through the Kubernetes API.

## APIs

- `GET /api/kubernetes/local/status`
- `GET /api/kubernetes/local/resources`
- `GET /api/kubernetes/local/logs`
- `POST /api/kubernetes/local/test`

Logs support `namespace`, `pod`, `deployment`, `app`, `container`, `after`, `search`, and `limit`.

## Troubleshooting

- Missing kubeconfig: check the path after `~` expansion or set `WATCHMEN_KUBECONFIG`.
- Bad context: run `kubectl config get-contexts` and set the exact context in Settings.
- Unreachable cluster: verify `kubectl --context <context> get ns` works from the same machine running Watchmen.
- Unauthorized: use a context with read access to namespaces, nodes, pods, services, deployments, daemonsets, statefulsets, and pod logs.
