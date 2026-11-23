import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import IacDriftPage from "@/app/dashboard/iac-drift/page";
import { TaskCenterProvider } from "@/components/TaskCenterProvider";

function renderPage() {
  return render(
    <TaskCenterProvider>
      <IacDriftPage />
    </TaskCenterProvider>
  );
}

describe("IacDriftPage PR & CLI handoff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/iac-drift") {
        return {
          ok: true,
          json: async () => ({
            tfResourceCount: 2,
            driftItems: [
              {
                id: "phantom-bucket-1",
                driftType: "phantom",
                resourceType: "storage_bucket",
                tfType: "google_storage_bucket",
                resourceId: "shadow-bucket",
                description: "Live bucket not tracked in Terraform.",
                severity: "high",
                cloud: "gcp",
              },
            ],
          }),
        } as Response;
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
  });

  it("opens RemediateModal and PushToCliModal for detected drift items", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /load sample/i }));
    fireEvent.click(screen.getByRole("button", { name: /analyze drift/i }));

    await waitFor(() => {
      expect(screen.getByText("shadow-bucket")).toBeInTheDocument();
    });

    const createPrButtons = screen.getAllByRole("button", { name: /create pr/i });
    expect(createPrButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(createPrButtons[0]);
    expect(await screen.findByText(/Phantom google_storage_bucket: shadow-bucket/i)).toBeInTheDocument();

    const closeBtn = screen.queryByRole("button", { name: /close/i });
    if (closeBtn) fireEvent.click(closeBtn);

    const sendToCliButtons = screen.getAllByRole("button", { name: /send to cli/i });
    expect(sendToCliButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(sendToCliButtons[0]);
    expect(await screen.findByText(/Send IaC Drift Items to CLI Task Queue/i)).toBeInTheDocument();
  });
});
