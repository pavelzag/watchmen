import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ContainerScanPage from "@/app/dashboard/container-scan/page";
import { TaskCenterProvider } from "@/components/TaskCenterProvider";

function renderPage() {
  return render(
    <TaskCenterProvider>
      <ContainerScanPage />
    </TaskCenterProvider>
  );
}

function mockFetchByRoute(handlers: {
  containerScan: () => any;
  containerScanPost?: () => any;
}) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "/api/container-scan") {
      return { ok: true, json: async () => handlers.containerScan() } as Response;
    }
    if (url === "/api/container-scan/scan" && handlers.containerScanPost) {
      return { ok: true, json: async () => handlers.containerScanPost!() } as Response;
    }
    if (url.startsWith("/api/tasks")) {
      return { ok: true, json: async () => ({ tasks: [] }) } as Response;
    }
    if (url.startsWith("/api/github/repos")) {
      return { ok: true, json: async () => ({ repos: [] }) } as Response;
    }
    if (url.startsWith("/api/settings/github-remediation")) {
      return { ok: true, json: async () => ({ defaults: null }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

describe("ContainerScanPage", () => {
  const writeTextMock = jest.fn(async () => {});

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
  });

  it("renders GCP scan diagnostics with copy buttons when Trivy is unavailable", async () => {
    mockFetchByRoute({
      containerScan: () => ({
        results: [],
        gcpProjects: ["theinsite-prod"],
        gcpAuthConfigured: true,
        trivyAvailable: false,
        scannedAt: "2026-11-23T15:30:00.000Z",
        warnings: [
          {
            service: "containeranalysis",
            projectId: "theinsite-prod",
            code: "api_not_enabled",
            retryable: false,
            message: "containeranalysis skipped for theinsite-prod: API not enabled.",
            detail:
              "Error: Container Analysis API has not been used in project 159171566143 before or it is disabled.",
            requiredApi: "containeranalysis.googleapis.com",
            enableApiCommand:
              "gcloud services enable containeranalysis.googleapis.com --project=theinsite-prod",
          },
        ],
      }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/GCP Container Scan Diagnostics/i)).toBeInTheDocument();
    });

    const copyAllBtn = screen.getByRole("button", { name: /copy all/i });
    fireEvent.click(copyAllBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
    const copiedAll = (writeTextMock.mock.calls[0] as unknown[])[0] as string;
    expect(copiedAll).toContain("gcloud services enable containeranalysis.googleapis.com --project=159171566143");
    expect(copiedAll).toContain("gcloud services enable containeranalysis.googleapis.com --project=theinsite-prod");
  });

  it("suppresses the noisy Container Analysis banner when Trivy is available and GCP images are present", async () => {
    mockFetchByRoute({
      containerScan: () => ({
        results: [
          {
            imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/app@sha256:aaa",
            imageName: "app:dev",
            cloud: "gcp",
            accountId: "theinsite-dev",
            scannedAt: "2026-11-23T15:00:00.000Z",
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, negligible: 0 },
            scanStatus: "unscanned",
          },
        ],
        warnings: [
          {
            service: "containeranalysis",
            projectId: "theinsite-dev",
            code: "permission_denied",
            retryable: false,
            message: "containeranalysis skipped for theinsite-dev: permission denied",
          },
        ],
        gcpProjects: ["theinsite-dev"],
        gcpAuthConfigured: true,
        trivyAvailable: true,
        scannedAt: "2026-11-23T15:30:00.000Z",
      }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("app:dev")).toBeInTheDocument();
    });

    expect(screen.queryByText(/GCP Container Scan Diagnostics/i)).not.toBeInTheDocument();
    expect(screen.getByText(/using built-in Trivy scanner/i)).toBeInTheDocument();
  });

  it("filters by name/CVE/date/severity, paginates results, and opens Send to CLI & Create PR modals", async () => {
    const now = Date.now();
    const images = Array.from({ length: 12 }, (_, idx) => ({
      imageRef: `europe-west3-docker.pkg.dev/theinsite-prod/cms/svc-${idx + 1}@sha256:${idx + 1}`,
      imageName: `svc-${idx + 1}:v1.0.${idx}`,
      cloud: "gcp" as const,
      accountId: "theinsite-prod",
      scannedAt: new Date(now - idx * 86400_000).toISOString(),
      scanner: "trivy",
      scanStatus: "scanned" as const,
      vulnerabilities:
        idx === 0
          ? [
              {
                cveId: "CVE-2026-9999",
                severity: "critical" as const,
                packageName: "openssl",
                installedVersion: "3.0.0",
                fixedVersion: "3.0.2",
                description: "Critical OpenSSL bug",
              },
            ]
          : [
              {
                cveId: `CVE-2026-000${idx}`,
                severity: "low" as const,
                packageName: "busybox",
                installedVersion: "1.35.0",
                description: "Low severity issue",
              },
            ],
      summary:
        idx === 0
          ? { critical: 1, high: 0, medium: 0, low: 0, negligible: 0 }
          : { critical: 0, high: 0, medium: 0, low: 1, negligible: 0 },
    }));

    mockFetchByRoute({
      containerScan: () => ({
        results: images,
        warnings: [],
        gcpProjects: ["theinsite-prod"],
        gcpAuthConfigured: true,
        trivyAvailable: true,
        scannedAt: new Date(now).toISOString(),
      }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("svc-1:v1.0.0")).toBeInTheDocument();
    });

    // Pagination: 10 per page out of 12
    expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument();
    expect(screen.queryByText("svc-11:v1.0.10")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Showing 11–12 of 12")).toBeInTheDocument();
    expect(screen.getByText("svc-11:v1.0.10")).toBeInTheDocument();

    // Search by CVE / package name resets to page 1 and filters cleanly
    const searchInput = screen.getByLabelText(/filter container scans/i);
    fireEvent.change(searchInput, { target: { value: "CVE-2026-9999" } });
    expect(screen.getByText("Showing 1–1 of 1")).toBeInTheDocument();
    expect(screen.getByText("svc-1:v1.0.0")).toBeInTheDocument();

    // Open Send to CLI modal
    const sendToCliBtns = screen.getAllByRole("button", { name: /send to cli/i });
    fireEvent.click(sendToCliBtns[0]);
    expect(await screen.findByText(/Send Container CVEs to CLI Task Queue/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    // Open Create PR modal
    const createPrBtns = screen.getAllByRole("button", { name: /create pr/i });
    fireEvent.click(createPrBtns[0]);
    expect(await screen.findByText(/Select container CVEs to remediate/i)).toBeInTheDocument();
  });

  it("triggers on-demand Trivy scanning for unscanned Artifact Registry images", async () => {
    mockFetchByRoute({
      containerScan: () => ({
        results: [
          {
            imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/app@sha256:aaa",
            imageName: "app:dev",
            cloud: "gcp",
            accountId: "theinsite-dev",
            scannedAt: "2026-11-23T15:00:00.000Z",
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, negligible: 0 },
            scanStatus: "unscanned",
          },
        ],
        warnings: [],
        gcpProjects: ["theinsite-dev"],
        gcpAuthConfigured: true,
        trivyAvailable: true,
        scannedAt: "2026-11-23T15:30:00.000Z",
      }),
      containerScanPost: () => ({
        scanned: [
          {
            imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/app@sha256:aaa",
            imageName: "app:dev",
            cloud: "gcp",
            accountId: "theinsite-dev",
            scannedAt: "2026-11-23T15:35:00.000Z",
            scanner: "trivy",
            scanStatus: "scanned",
            vulnerabilities: [
              {
                cveId: "CVE-2026-9001",
                severity: "critical",
                packageName: "openssl",
                installedVersion: "3.0.0",
                fixedVersion: "3.0.2",
                description: "Critical OpenSSL flaw",
              },
            ],
            summary: { critical: 1, high: 0, medium: 0, low: 0, negligible: 0 },
          },
        ],
        errors: [],
      }),
    });

    renderPage();

    const scanAllBtn = await screen.findByRole("button", { name: /scan unscanned \(1\)/i });
    fireEvent.click(scanAllBtn);

    await waitFor(() => {
      expect(screen.getByText("TRIVY")).toBeInTheDocument();
      expect(screen.getByText("1 CRITICAL")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/container-scan/scan",
      expect.objectContaining({ method: "POST" })
    );
  });
});
