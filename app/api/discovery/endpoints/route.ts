import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql, ensureGcpSnapshotTable, ensureAwsSnapshotTable } from "@/lib/db";
import type { GcpSnapshot } from "@/lib/gcp/types";
import type { AwsSnapshot } from "@/lib/aws/types";

export interface DiscoveredEndpoint {
    id: string;
    label: string;
    url: string;
    provider: "gcp" | "aws" | "mock";
    type: string;
    description: string;
}

export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session || !session.user?.email) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = session.user.email;
    const endpoints: DiscoveredEndpoint[] = [
        {
            id: "mock",
            label: "Local Mock",
            url: "",
            provider: "mock",
            type: "Simulation",
            description: "Simulated trace in local environment"
        }
    ];

    try {
        // 1. Fetch GCP Endpoints
        await ensureGcpSnapshotTable();
        const gcpResult = await sql`
            SELECT snapshot FROM user_snapshots WHERE user_email = ${email}
        `;

        if (gcpResult.rows.length > 0) {
            const snapshot = gcpResult.rows[0].snapshot as GcpSnapshot;

            // Extract Cloud Run Services
            if (snapshot.cloudRunServices) {
                snapshot.cloudRunServices.forEach(svc => {
                    if (svc.url) {
                        endpoints.push({
                            id: `gcp-run-${svc.name}`,
                            label: `CR: ${svc.name}`,
                            url: svc.url,
                            provider: "gcp",
                            type: "Cloud Run",
                            description: `GCP Cloud Run service in ${svc.region}`
                        });
                    }
                });
            }

            // Extract VM external IPs as candidate endpoints
            if (snapshot.vms) {
                snapshot.vms.forEach(vm => {
                    if (vm.externalIp) {
                        endpoints.push({
                            id: `gcp-vm-${vm.name}`,
                            label: `VM: ${vm.name}`,
                            url: `http://${vm.externalIp}`,
                            provider: "gcp",
                            type: "Compute Engine",
                            description: `External VM endpoint in ${vm.zone}`
                        });
                    }
                });
            }

            // Extract GCP Load Balancers (K8s Ingress/Service)
            if (snapshot.loadBalancers) {
                snapshot.loadBalancers.forEach(lb => {
                    if (lb.ipAddress) {
                        endpoints.push({
                            id: `gcp-lb-${lb.name}`,
                            label: `LB: ${lb.name}`,
                            url: `http://${lb.ipAddress}`,
                            provider: "gcp",
                            type: "Load Balancer",
                            description: `GCP ${lb.type} Load Balancer (often K8s Ingress)`
                        });
                    }
                });
            }
        }

        // 2. Fetch AWS Endpoints
        await ensureAwsSnapshotTable();
        const awsResult = await sql`
            SELECT snapshot FROM aws_snapshots WHERE user_email = ${email}
        `;

        if (awsResult.rows.length > 0) {
            const snapshot = awsResult.rows[0].snapshot as AwsSnapshot;

            // Extract Lambda Functions
            if (snapshot.lambdaFunctions) {
                snapshot.lambdaFunctions.forEach(fn => {
                    endpoints.push({
                        id: `aws-lambda-${fn.functionName}`,
                        label: `λ: ${fn.functionName}`,
                        url: `https://${fn.functionName}.lambda-url.${fn.region}.on.aws`,
                        provider: "aws",
                        type: "Lambda",
                        description: `AWS Lambda function in ${fn.region}`
                    });
                });
            }

            // Extract AWS Load Balancers (EKS Ingress/Service)
            if (snapshot.loadBalancers) {
                snapshot.loadBalancers.forEach(lb => {
                    if (lb.dnsName) {
                        endpoints.push({
                            id: `aws-lb-${lb.name}`,
                            label: `ELB: ${lb.name}`,
                            url: `http://${lb.dnsName}`,
                            provider: "aws",
                            type: "Elastic Load Balancer",
                            description: `AWS ${lb.type} LB (often EKS Ingress)`
                        });
                    }
                });
            }
        }

        return NextResponse.json({ endpoints });
    } catch (error) {
        console.error("Discovery error:", error);
        return NextResponse.json({ endpoints, warning: "Failed to fully refresh from database" });
    }
}
