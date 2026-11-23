import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ContainerScanPage from "@/app/dashboard/container-scan/page";

describe("ContainerScanPage diagnostics copy controls", () => {
  const writeTextMock = jest.fn(async () => {});

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
  });

  it("renders GCP scan diagnostics with copy buttons including caller project enable command", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        gcpProjects: ["theinsite-prod"],
        gcpAuthConfigured: true,
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
    }) as jest.Mock;

    render(<ContainerScanPage />);

    await waitFor(() => {
      expect(screen.getByText(/GCP Container Scan Diagnostics/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText("containeranalysis skipped for theinsite-prod: API not enabled.")
    ).toBeInTheDocument();

    const copyAllBtn = screen.getByRole("button", { name: /copy all/i });
    fireEvent.click(copyAllBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
    const copiedAll = (writeTextMock.mock.calls[0] as unknown[])[0] as string;
    expect(copiedAll).toContain("containeranalysis skipped for theinsite-prod: API not enabled.");
    expect(copiedAll).toContain("gcloud services enable containeranalysis.googleapis.com --project=159171566143");
    expect(copiedAll).toContain("gcloud services enable containeranalysis.googleapis.com --project=theinsite-prod");

    const copyCmdBtn = screen.getByRole("button", { name: /copy cmd/i });
    fireEvent.click(copyCmdBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(2);
    });
    const copiedCmd = (writeTextMock.mock.calls[1] as unknown[])[0] as string;
    expect(copiedCmd).toContain("gcloud services enable containeranalysis.googleapis.com --project=159171566143");
  });

  it("triggers on-demand Trivy scanning for unscanned Artifact Registry images", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
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

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ContainerScanPage />);

    const scanAllBtn = await screen.findByRole("button", { name: /scan unscanned \(1\)/i });
    fireEvent.click(scanAllBtn);

    await waitFor(() => {
      expect(screen.getByText("TRIVY")).toBeInTheDocument();
      expect(screen.getByText("1 CRITICAL")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/container-scan/scan",
      expect.objectContaining({ method: "POST" })
    );
  });
});
