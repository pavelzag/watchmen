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
});
