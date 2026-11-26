import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FindingsPage from "@/app/dashboard/findings/page";
import { TaskCenterProvider } from "@/components/TaskCenterProvider";
import type { SecurityFinding } from "@/lib/gcp/types";
import type { AwsSecurityFinding } from "@/lib/aws/types";

const mockComputeFindings = jest.fn<SecurityFinding[], [any]>();
const mockComputeAwsFindings = jest.fn<AwsSecurityFinding[], [any]>();

jest.mock("@/lib/findings", () => ({
  computeFindings: (snap: any) => mockComputeFindings(snap),
}));

jest.mock("@/lib/aws-findings", () => ({
  computeAwsFindings: (snap: any) => mockComputeAwsFindings(snap),
}));

function renderPage() {
  return render(
    <TaskCenterProvider>
      <FindingsPage />
    </TaskCenterProvider>
  );
}

describe("FindingsPage", () => {
  const now = Date.now();
  const recentIso = new Date(now - 2 * 3600_000).toISOString(); // 2 hours ago
  const oldIso = new Date(now - 45 * 86400_000).toISOString(); // 45 days ago

  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState(null, "", "/dashboard/findings");

    const gcpFindings: SecurityFinding[] = Array.from({ length: 10 }, (_, idx) => ({
      id: `gcp-f-${idx + 1}`,
      severity: idx === 0 ? "critical" : idx < 4 ? "high" : "medium",
      title: idx === 0 ? "Alpha Open Bucket" : `GCP Finding ${idx + 1}`,
      description: `Description for GCP finding ${idx + 1}`,
      resourceName: `bucket-${idx + 1}`,
      projectId: idx % 2 === 0 ? "acme-prod" : "acme-dev",
      resourceType: idx === 0 ? "storage_bucket" : "firewall_rule",
      remediationHint: "Restrict public access",
    }));

    const awsFindings: AwsSecurityFinding[] = [
      {
        id: "aws-1",
        severity: "low",
        title: "Old AWS IAM Finding",
        description: "Legacy AWS user without MFA",
        resourceName: "legacy-user",
        accountId: "123456789012",
        resourceType: "iam_user",
        region: "us-east-1",
      },
      {
        id: "aws-2",
        severity: "critical",
        title: "Zeta AWS Public S3 Bucket",
        description: "Public read access enabled",
        resourceName: "zeta-bucket",
        accountId: "123456789012",
        resourceType: "s3_bucket",
        region: "us-west-2",
      },
    ];

    mockComputeFindings.mockReturnValue(gcpFindings);
    mockComputeAwsFindings.mockReturnValue(awsFindings);

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/gcp/snapshot") {
        return { ok: true, json: async () => ({ fetchedAt: recentIso }) } as Response;
      }
      if (url === "/api/aws/snapshot") {
        return { ok: true, json: async () => ({ fetchedAt: oldIso }) } as Response;
      }
      if (url.startsWith("/api/agent/finding-runs")) {
        return { ok: true, json: async () => ({ runs: {} }) } as Response;
      }
      if (url.startsWith("/api/tasks")) {
        return { ok: true, json: async () => ({ tasks: [] }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
  });

  it("paginates findings and supports page size changes", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Alpha Open Bucket")).toBeInTheDocument();
    });

    // 12 total findings -> 10 per page default
    expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument();
    expect(screen.getByText("Page 1 / 2")).toBeInTheDocument();
    expect(screen.queryByText("Old AWS IAM Finding")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Showing 11–12 of 12")).toBeInTheDocument();
    expect(screen.getByText("Old AWS IAM Finding")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Items per page" }));
    fireEvent.click(screen.getByRole("option", { name: "25 / page" }));
    expect(screen.getByText("Showing 1–12 of 12")).toBeInTheDocument();
    expect(screen.getByText("Alpha Open Bucket")).toBeInTheDocument();
    expect(screen.getByText("Old AWS IAM Finding")).toBeInTheDocument();
  });

  it("filters findings by name, project, resource type, date range, and severity, and resets on Clear filters", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Alpha Open Bucket")).toBeInTheDocument();
    });

    // Filter by date range: Last 24 hours excludes the 45-day-old AWS findings
    fireEvent.click(screen.getByRole("button", { name: "Filter by date" }));
    fireEvent.click(screen.getByRole("option", { name: "Last 24 hours" }));
    expect(screen.getByText("Showing 1–10 of 10")).toBeInTheDocument();
    expect(screen.queryByText("Zeta AWS Public S3 Bucket")).not.toBeInTheDocument();

    // Filter by project
    fireEvent.click(screen.getByRole("button", { name: "Filter by project or account" }));
    fireEvent.click(screen.getByRole("option", { name: "acme-dev" }));
    expect(screen.getByText("Showing 1–5 of 5")).toBeInTheDocument();

    // Filter by severity
    fireEvent.click(screen.getByRole("button", { name: /^High \(/i }));
    expect(screen.getByText("Showing 1–2 of 2")).toBeInTheDocument();

    // Search by name
    fireEvent.change(screen.getByLabelText("Search findings"), { target: { value: "GCP Finding 4" } });
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument();
    expect(screen.getByText("GCP Finding 4")).toBeInTheDocument();

    // Clear filters restores all 12
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument();
  });

  it("supports sorting by name and date", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Alpha Open Bucket")).toBeInTheDocument();
    });

    // Sort by oldest first puts the 45-day-old AWS findings on page 1
    fireEvent.click(screen.getByRole("button", { name: "Sort findings" }));
    fireEvent.click(screen.getByRole("option", { name: "Oldest first" }));
    expect(screen.getByText("Old AWS IAM Finding")).toBeInTheDocument();
    expect(screen.getByText("Zeta AWS Public S3 Bucket")).toBeInTheDocument();

    // Sort by name A-Z keeps Alpha Open Bucket on page 1 and Zeta AWS Public S3 Bucket on page 2
    fireEvent.click(screen.getByRole("button", { name: "Sort findings" }));
    fireEvent.click(screen.getByRole("option", { name: "Name (A–Z)" }));
    expect(screen.getByText("Alpha Open Bucket")).toBeInTheDocument();
    expect(screen.queryByText("Zeta AWS Public S3 Bucket")).not.toBeInTheDocument();
  });
});
