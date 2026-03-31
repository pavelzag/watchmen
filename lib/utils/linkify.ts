import { HardDrive, Server, KeySquare, MonitorDot, Play, Database, BarChart3, Radio, Lock, Flame, User, ShieldAlert, Users } from "lucide-react";
import type { ResourceItem } from "@/lib/claude/query-processor";

export const RESOURCE_LINKS: Record<string, { path: string; label: string; Icon: any }> = {
    bucket: { path: "/dashboard/buckets", label: "Buckets", Icon: HardDrive },
    s3_bucket: { path: "/dashboard/buckets", label: "Buckets", Icon: HardDrive },
    gke_cluster: { path: "/dashboard/clusters", label: "GKE Clusters", Icon: Server },
    eks_cluster: { path: "/dashboard/aws", label: "EKS Clusters", Icon: Server },
    service_account: { path: "/dashboard/service-accounts", label: "Service Accounts", Icon: KeySquare },
    vm: { path: "/dashboard/vms", label: "VMs", Icon: MonitorDot },
    ec2_instance: { path: "/dashboard/vms", label: "EC2 Instances", Icon: MonitorDot },
    cloud_run: { path: "/dashboard/cloud-run", label: "Cloud Run", Icon: Play },
    lambda_function: { path: "/dashboard/aws", label: "Lambda Functions", Icon: Play },
    cloud_sql: { path: "/dashboard/cloud-sql", label: "Cloud SQL", Icon: Database },
    rds_instance: { path: "/dashboard/aws", label: "RDS Instances", Icon: Database },
    bigquery: { path: "/dashboard/bigquery", label: "BigQuery", Icon: BarChart3 },
    pubsub: { path: "/dashboard/pubsub", label: "Pub/Sub", Icon: Radio },
    secret: { path: "/dashboard/secrets", label: "Secrets", Icon: Lock },
    firewall: { path: "/dashboard/firewall", label: "Firewall Rules", Icon: Flame },
    iam_user: { path: "/dashboard/aws/iam", label: "IAM Users", Icon: User },
    iam_role: { path: "/dashboard/aws/iam", label: "IAM Roles", Icon: KeySquare },
    aws_account: { path: "/dashboard/aws", label: "AWS Account", Icon: Server },
    container_image: { path: "/dashboard/container-scan", label: "Container Images", Icon: Server },
};

export function getResourceHref(item: ResourceItem): string {
    const base = RESOURCE_LINKS[item.type ?? ""]?.path;
    if (!base) return "#";
    return `${base}?search=${encodeURIComponent(item.name)}`;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function linkifyText(
    text: string,
    resources: ResourceItem[],
    customHref?: (item: ResourceItem) => string
): string {
    if (!resources.length) return text;

    // Sort by length descending to prevent partial matching (e.g. "my-bucket-archive" before "my-bucket")
    const sorted = [...resources].sort((a, b) => b.name.length - a.name.length);
    const seen = new Set<string>();
    let out = text;

    // Use CSS variables for automatic theme support
    const linkStyle = "color:var(--text-primary);text-decoration:underline;text-decoration-color:var(--border-dim);font-family:inherit;font-weight:600";

    for (const item of sorted) {
        if (seen.has(item.name)) continue;
        seen.add(item.name);

        const href = customHref ? customHref(item) : getResourceHref(item);
        if (href === "#") continue;

        const esc = escapeRegex(item.name);
        // Boundary check to avoid matching parts of words
        const regex = new RegExp(`(^|[^\\w@./:-])${esc}(?=[^\\w@./:"'>-]|$)`, "gm");

        const safeDisplayName = item.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        out = out.replace(regex, (_, pre) =>
            `${pre}<a href="${href}" style="${linkStyle}">${safeDisplayName}</a>`
        );
    }
    return out;
}
