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

  it("hides optional Container Analysis warnings completely when Trivy is available", async () => {
    mockFetchByRoute({
      containerScan: () => ({
        results: [],
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
      expect(screen.getByText(/No container images found in Artifact Registry/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/GCP Container Scan Diagnostics/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/containeranalysis skipped/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/GCP Container Analysis is not enabled/i)).not.toBeInTheDocument();
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

  it("uses custom TerminalSelect dropdowns and filters to the latest image per application", async () => {
    mockFetchByRoute({
      containerScan: () => ({
        results: [
          {
            // Older app image pushed 10 days ago, but Trivy-scanned 1 minute ago
            imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/web@sha256:old1",
            imageName: "web:v1.0.0",
            cloud: "gcp",
            accountId: "theinsite-prod",
            imageUpdatedAt: "2026-11-14T10:00:00.000Z",
            scannedAt: "2026-11-24T10:00:00.000Z",
            scanner: "trivy",
            scanStatus: "scanned",
            vulnerabilities: [
              {
                cveId: "CVE-2026-1111",
                severity: "critical",
                packageName: "openssl",
                installedVersion: "3.0.0",
                description: "Old version vuln",
              },
            ],
            summary: { critical: 1, high: 0, medium: 0, low: 0, negligible: 0 },
          },
          {
            // Newer version of the same app pushed yesterday
            imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/web@sha256:new2",
            imageName: "web:v2.0.0",
            cloud: "gcp",
            accountId: "theinsite-prod",
            imageUpdatedAt: "2026-11-23T10:00:00.000Z",
            scannedAt: "2026-11-23T10:00:00.000Z",
            scanStatus: "clean",
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, negligible: 0 },
          },
          {
            // Different project (dev) for same app name
            imageRef: "europe-west3-docker.pkg.dev/theinsite-dev/cms/web@sha256:dev1",
            imageName: "web:dev-latest",
            cloud: "gcp",
            accountId: "theinsite-dev",
            imageUpdatedAt: "2026-11-22T10:00:00.000Z",
            scannedAt: "2026-11-22T10:00:00.000Z",
            scanStatus: "unscanned",
            vulnerabilities: [],
            summary: { critical: 0, high: 0, medium: 0, low: 0, negligible: 0 },
          },
        ],
        warnings: [],
        gcpProjects: ["theinsite-prod", "theinsite-dev"],
        gcpAuthConfigured: true,
        trivyAvailable: true,
        scannedAt: "2026-11-24T10:00:00.000Z",
      }),
    });

    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText("web:v1.0.0")).toBeInTheDocument();
    });

    // No generic native <select> elements
    expect(container.querySelectorAll("select")).toHaveLength(0);

    // Toggle "Latest per app (2)"
    fireEvent.click(screen.getByRole("button", { name: /latest per app \(2\)/i }));
    expect(screen.queryByText("web:v1.0.0")).not.toBeInTheDocument();
    expect(screen.getByText("web:v2.0.0")).toBeInTheDocument();
    expect(screen.getByText("web:dev-latest")).toBeInTheDocument();

    // Custom TerminalSelect dropdown works (e.g. Status: Clean)
    fireEvent.click(screen.getByRole("button", { name: "Filter by scan status" }));
    fireEvent.click(screen.getByRole("option", { name: "Clean (0 CVEs)" }));
    expect(screen.getByText("web:v2.0.0")).toBeInTheDocument();
    expect(screen.queryByText("web:dev-latest")).not.toBeInTheDocument();
  });

  it("allows multi-selecting Critical, High, and Medium severities without extra preset buttons", async () => {
    mockFetchByRoute({
      containerScan: () => ({
        results: [
          {
            imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/crit-img@sha256:1",
            imageName: "crit-img:1.0",
            cloud: "gcp",
            accountId: "theinsite-prod",
            scannedAt: "2026-11-24T10:00:00.000Z",
            scanner: "trivy",
            scanStatus: "scanned",
            vulnerabilities: [
              {
                cveId: "CVE-2026-1001",
                severity: "critical",
                packageName: "openssl",
                installedVersion: "3.0.0",
                description: "Crit vuln",
              },
            ],
            summary: { critical: 1, high: 0, medium: 0, low: 0, negligible: 0 },
          },
          {
            imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/med-img@sha256:2",
            imageName: "med-img:1.0",
            cloud: "gcp",
            accountId: "theinsite-prod",
            scannedAt: "2026-11-24T10:00:00.000Z",
            scanner: "trivy",
            scanStatus: "scanned",
            vulnerabilities: [
              {
                cveId: "CVE-2026-2002",
                severity: "medium",
                packageName: "zlib",
                installedVersion: "1.2.0",
                description: "Med vuln",
              },
            ],
            summary: { critical: 0, high: 0, medium: 1, low: 0, negligible: 0 },
          },
          {
            imageRef: "europe-west3-docker.pkg.dev/theinsite-prod/cms/low-img@sha256:3",
            imageName: "low-img:1.0",
            cloud: "gcp",
            accountId: "theinsite-prod",
            scannedAt: "2026-11-24T10:00:00.000Z",
            scanner: "trivy",
            scanStatus: "scanned",
            vulnerabilities: [
              {
                cveId: "CVE-2026-3003",
                severity: "low",
                packageName: "busybox",
                installedVersion: "1.35.0",
                description: "Low vuln",
              },
            ],
            summary: { critical: 0, high: 0, medium: 0, low: 1, negligible: 0 },
          },
        ],
        warnings: [],
        gcpProjects: ["theinsite-prod"],
        gcpAuthConfigured: true,
        trivyAvailable: true,
        scannedAt: "2026-11-24T10:00:00.000Z",
      }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("crit-img:1.0")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Crit \+ High \+ Med/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Crit \+ Med/i)).not.toBeInTheDocument();

    // Select Critical + Medium
    fireEvent.click(screen.getByRole("button", { name: /^Critical \(1\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Medium \(1\)/i }));

    expect(screen.getByText("crit-img:1.0")).toBeInTheDocument();
    expect(screen.getByText("med-img:1.0")).toBeInTheDocument();
    expect(screen.queryByText("low-img:1.0")).not.toBeInTheDocument();
    expect(screen.getByText(/2 images · 2 matching CVEs/i)).toBeInTheDocument();

    // Reset via All
    fireEvent.click(screen.getByRole("button", { name: /^All \(3\)/i }));
    expect(screen.getByText("low-img:1.0")).toBeInTheDocument();
  });
});
