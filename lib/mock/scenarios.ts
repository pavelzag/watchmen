import {
    ShieldCheck,
    Server,
    Cloud,
    Database,
    CheckCircle2,
    Cpu,
    Layers,
    Wifi,
    Zap,
    Brain,
    Layout,
    MessageSquare,
    Search,
    Lock,
    Bell,
    Globe,
    HardDrive,
    Activity,
    Code
} from "lucide-react";

export type InfrastructureNode = {
    id: string;
    label: string;
    icon: any;
    description: string;
    type: "compute" | "network" | "storage" | "security" | "other";
};

export type PodStatus = "Running" | "Pending" | "Error" | "Terminated";

export type PodDetail = {
    name: string;
    status: PodStatus;
    restarts: number;
    age: string;
    cpu: string;
    memory: string;
    logs: string[];
};

export type NodeDetail = {
    title: string;
    description: string;
    details: {
        label: string;
        value: string;
        type?: "code" | "text" | "status";
    }[];
    pods?: PodDetail[];
};

export type Scenario = {
    id: string;
    label: string;
    description: string;
    provider: "gcp" | "aws" | "hybrid";
    nodes: InfrastructureNode[];
    nodeDetails: Record<string, NodeDetail>;
};

export const SCENARIOS: Scenario[] = [
    {
        id: "gke-ha",
        label: "GKE High-Availability Cluster",
        description: "Standard GKE production setup with Ingress and multi-pod backend.",
        provider: "gcp",
        nodes: [
            { id: "ingress", label: "Cloud Ingress", icon: "Globe", description: "L7 Load Balancing", type: "network" },
            { id: "service", label: "K8s Service", icon: "Layers", description: "Internal Cluster Routing", type: "network" },
            { id: "pods", label: "GKE Pods (Go)", icon: "Cloud", description: "Compute Workload", type: "compute" },
            { id: "db", label: "Cloud SQL", icon: "Database", description: "HA Postgres Instance", type: "storage" },
            { id: "complete", label: "Success", icon: "CheckCircle2", description: "Transaction Committed", type: "other" }
        ],
        nodeDetails: {
            ingress: {
                title: "GCP Global HTTP(S) Load Balancer",
                description: "Handling SSL termination and edge routing.",
                details: [
                    { label: "IP Address", value: "34.120.45.67", type: "text" },
                    { label: "SSL Policy", value: "TLS 1.3 (Modern)", type: "status" },
                    { label: "WAF (Armor)", value: "Rule: SQL-Injection-Mitigation (Active)", type: "status" }
                ]
            },
            pods: {
                title: "GKE Workload: watchmen-backend",
                description: "Auto-scaling pod group in us-central1-a.",
                details: [
                    { label: "Namespace", value: "production", type: "text" },
                    { label: "HPA Status", value: "Targets: 45% CPU (Current: 12%)", type: "status" }
                ],
                pods: [
                    {
                        name: "watchmen-backend-7f4b-1",
                        status: "Running",
                        restarts: 0,
                        age: "4d2h",
                        cpu: "120m",
                        memory: "256Mi",
                        logs: [
                            "2026-03-07 00:00:01 INFO: Initializing server on port 8080",
                            "2026-03-07 00:00:05 INFO: Connected to Cloud SQL haunt-db-01",
                            "2026-03-07 00:10:30 DEBUG: Received POST /api/trace - TraceID: 8821-ax"
                        ]
                    },
                    {
                        name: "watchmen-backend-7f4b-2",
                        status: "Running",
                        restarts: 1,
                        age: "12h",
                        cpu: "145m",
                        memory: "280Mi",
                        logs: [
                            "2026-03-07 00:00:01 INFO: Server started",
                            "2026-03-07 00:05:22 WARN: High latency detected on upstream",
                            "2026-03-07 00:10:31 DEBUG: Processing trace logic for req-9981-ax"
                        ]
                    }
                ]
            }
        }
    },
    {
        id: "serverless-eventing",
        label: "Serverless Event Mesh",
        description: "Cloud Run to Pub/Sub async processing chain.",
        provider: "gcp",
        nodes: [
            { id: "auth", label: "Identity Platform", icon: "ShieldCheck", description: "Firebase Auth Check", type: "security" },
            { id: "run", label: "Cloud Run", icon: "Cloud", description: "Ingestion Service", type: "compute" },
            { id: "pubsub", label: "Pub/Sub Topic", icon: "MessageSquare", description: "Async Message Hub", type: "network" },
            { id: "fn", label: "Cloud Function", icon: "Zap", description: "Event Processor", type: "compute" },
            { id: "firestore", label: "Firestore", icon: "HardDrive", description: "NoSQL Persistence", type: "storage" }
        ],
        nodeDetails: {
            run: {
                title: "Cloud Run: ingest-api",
                description: "Stateless container scaling to zero.",
                details: [
                    { label: "Region", value: "europe-west1", type: "text" },
                    { label: "Min Instances", value: "0 (Conserving Cost)", type: "status" },
                    { label: "Memory Limit", value: "512Mi", type: "text" }
                ],
                pods: [
                    {
                        name: "ingest-api-rev-002-xb",
                        status: "Running",
                        restarts: 0,
                        age: "2m",
                        cpu: "40m",
                        memory: "128Mi",
                        logs: [
                            "v1.2.0 starting up...",
                            "Listening on port 8080",
                            "POST /event handled in 15ms"
                        ]
                    }
                ]
            }
        }
    },
    {
        id: "aws-eks-mesh",
        label: "AWS EKS Event Mesh",
        description: "ALB to EKS with SQS and Lambda downstream.",
        provider: "aws",
        nodes: [
            { id: "alb", label: "Application LB", icon: "Globe", description: "AWS ELB v2", type: "network" },
            { id: "eks", label: "EKS Fargate", icon: "Layers", description: "Managed Kubernetes", type: "compute" },
            { id: "sqs", label: "SQS Queue", icon: "MessageSquare", description: "Durability Layer", type: "network" },
            { id: "lambda", label: "AWS Lambda", icon: "Zap", description: "Worker Node", type: "compute" },
            { id: "ddb", label: "DynamoDB", icon: "Database", description: "Key-Value Store", type: "storage" }
        ],
        nodeDetails: {
            eks: {
                title: "EKS Fargate: core-services",
                description: "Serverless EKS execution environment.",
                details: [
                    { label: "VPCID", value: "vpc-0a1b2c3d", type: "text" },
                    { label: "Subnets", value: "private-us-east-1a, 1b", type: "text" },
                    { label: "Security Group", value: "sg-eks-internal", type: "status" }
                ],
                pods: [
                    {
                        name: "processor-dp-55c-x",
                        status: "Running",
                        restarts: 0,
                        age: "10d",
                        cpu: "250m",
                        memory: "512Mi",
                        logs: ["Poll SQS...", "Message received: ID-123", "Ack sent"]
                    }
                ]
            }
        }
    },
    {
        id: "waf-protected",
        label: "WAF Protected API Stack",
        description: "Global Load Balancer with Cloud Armor and API Gateway.",
        provider: "gcp",
        nodes: [
            { id: "global", label: "Global LB", icon: "Globe", description: "Anycast Frontend", type: "network" },
            { id: "armor", label: "Cloud Armor", icon: "ShieldCheck", description: "DDoS & WAF Protection", type: "security" },
            { id: "gateway", label: "API Gateway", icon: "Lock", description: "Config Management", type: "security" },
            { id: "run", label: "Cloud Run", icon: "Cloud", description: "Private Backend", type: "compute" },
            { id: "secret", label: "Secret Manager", icon: "Lock", description: "Credential Access", type: "security" }
        ],
        nodeDetails: {
            armor: {
                title: "Cloud Armor Security Policy",
                description: "Filtering traffic at the Google edge.",
                details: [
                    { label: "Policy Type", value: "Adaptive Protection", type: "status" },
                    { label: "Blocked Requests", value: "1,242 (Last Hour)", type: "status" },
                    { label: "Active Rules", value: "SQLi, XSS, Geo-Blocking (Iran/China)", type: "text" }
                ]
            }
        }
    },
    {
        id: "ai-inference",
        label: "AI Inference Pipeline",
        description: "Frontend to Inference Engine with Vector storage.",
        provider: "gcp",
        nodes: [
            { id: "fe", label: "Next.js UI", icon: "Layout", description: "Main Dashboard", type: "compute" },
            { id: "vertex", label: "Vertex AI", icon: "Brain", description: "Model Inference (LLM)", type: "compute" },
            { id: "pinecone", label: "Pinecone", icon: "Search", description: "Vector Database", type: "storage" },
            { id: "storage", label: "GCS Bucket", icon: "HardDrive", description: "Blob Data", type: "storage" }
        ],
        nodeDetails: {
            vertex: {
                title: "Vertex AI Endpoint: chat-model-v4",
                description: "Google-managed LLM deployment.",
                details: [
                    { label: "Model ID", value: "gemini-1.5-pro", type: "text" },
                    { label: "Quota Status", value: "85% Remaining", type: "status" },
                    { label: "Latencies", value: "P99: 1400ms", type: "status" }
                ]
            }
        }
    },
    {
        id: "service-mesh",
        label: "Istio Service Mesh",
        description: "Microservices with sidecar communication and mTLS.",
        provider: "gcp",
        nodes: [
            { id: "mesh-ingress", label: "Istio Ingress", icon: "Globe", description: "Mesh Gateway", type: "network" },
            { id: "svca", label: "Order Service", icon: "Layers", description: "Istio Sidecar (mTLS)", type: "compute" },
            { id: "svcb", label: "Payment Service", icon: "Layers", description: "Istio Sidecar (mTLS)", type: "compute" },
            { id: "redis", label: "Redis Cluster", icon: "Database", description: "Distributed Cache", type: "storage" }
        ],
        nodeDetails: {
            svca: {
                title: "Order Service (mTLS Enabled)",
                description: "Encrypted internal cluster communication.",
                details: [
                    { label: "Sidecar Version", value: "Envoy 1.29", type: "text" },
                    { label: "mTLS Mode", value: "STRICT", type: "status" },
                    { label: "Upstream Conn", value: "payment-svc.prod.svc.cluster.local", type: "text" }
                ]
            }
        }
    },
    {
        id: "hybrid-cloud",
        label: "Hybrid Cloud Connectivity",
        description: "Cloud to On-Prem VPN tunnel for legacy integration.",
        provider: "hybrid",
        nodes: [
            { id: "vm", label: "GCP VM", icon: "Server", description: "Jump Host", type: "compute" },
            { id: "vpn", label: "Cloud VPN", icon: "Wifi", description: "IPsec Tunnel (Established)", type: "network" },
            { id: "onprem", label: "On-Prem Gateway", icon: "Server", description: "Cisco CSR 1000V", type: "network" },
            { id: "db2", label: "Mainframe DB2", icon: "Database", description: "Legacy Core Data", type: "storage" }
        ],
        nodeDetails: {
            vpn: {
                title: "Cloud VPN Tunnel: corp-tunnel-01",
                description: "Secure cross-premises link.",
                details: [
                    { label: "Tunnel Status", value: "Established (BGP Up)", type: "status" },
                    { label: "Bandwidth", value: "3.0 Gbps (Peak)", type: "text" },
                    { label: "Remote Peer", value: "203.0.113.10", type: "text" }
                ]
            }
        }
    },
    {
        id: "global-edge",
        label: "Global Edge Content",
        description: "CDN distribution with origin storage.",
        provider: "gcp",
        nodes: [
            { id: "cdn", label: "Cloud CDN", icon: "Globe", description: "Edge Caching", type: "network" },
            { id: "lb", label: "HTTPS LB", icon: "Server", description: "Origin Routing", type: "network" },
            { id: "bucket", label: "GCS Origins", icon: "HardDrive", description: "Static Assets", type: "storage" }
        ],
        nodeDetails: {
            cdn: {
                title: "Cloud CDN Endpoint",
                description: "Low-latency asset delivery.",
                details: [
                    { label: "Cache Hit Rate", value: "94.2%", type: "status" },
                    { label: "Active PoPs", value: "124 global locations", type: "text" }
                ]
            }
        }
    },
    {
        id: "realtime-stream",
        label: "Real-time Data Stream",
        description: "Ingestion to Warehouse via Dataflow ETL.",
        provider: "gcp",
        nodes: [
            { id: "iot", label: "IoT Sensors", icon: "Activity", description: "Payload Sources", type: "other" },
            { id: "stream", label: "Pub/Sub Stream", icon: "MessageSquare", description: "Message Queue", type: "network" },
            { id: "dataflow", label: "Cloud Dataflow", icon: "Cpu", description: "Streaming ETL (Apache Beam)", type: "compute" },
            { id: "bq", label: "BigQuery", icon: "Database", description: "Petabyte-scale Warehouse", type: "storage" }
        ],
        nodeDetails: {
            dataflow: {
                title: "Dataflow Job: iot-stream-v2",
                description: "Processing real-time telemetry data.",
                details: [
                    { label: "Worker Count", value: "12 (Auto-scaling)", type: "text" },
                    { label: "System Lag", value: "240ms", type: "status" },
                    { label: "Throughput", value: "125k events/sec", type: "status" }
                ]
            }
        }
    },
    {
        id: "auto-remediation",
        label: "Auto-Remediation Loop",
        description: "Automated response to infrastructure incidents.",
        provider: "aws",
        nodes: [
            { id: "alarm", label: "CloudWatch Alarm", icon: "Bell", description: "CPU > 90% Threshold", type: "security" },
            { id: "sns", label: "SNS Notification", icon: "MessageSquare", description: "Incident Alert", type: "network" },
            { id: "lambda-fix", label: "Lambda Fixer", icon: "Zap", description: "Invoking Remediation", type: "compute" },
            { id: "ec2", label: "EC2 Instance", icon: "Server", description: "Rebooting Target", type: "compute" }
        ],
        nodeDetails: {
            alarm: {
                title: "AWS CloudWatch Alarm: critical-cpu",
                description: "Monitoring EC2 instance health.",
                details: [
                    { label: "Metric Name", value: "CPUUtilization", type: "text" },
                    { label: "State", value: "ALARM", type: "status" },
                    { label: "Action", value: "Publish to SNS", type: "text" }
                ]
            }
        }
    }
];
