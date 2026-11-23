import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CompliancePage from "@/app/dashboard/compliance/page";
import { TaskCenterProvider } from "@/components/TaskCenterProvider";

function renderPage() {
  return render(
    <TaskCenterProvider>
      <CompliancePage />
    </TaskCenterProvider>
  );
}

describe("CompliancePage PR & CLI handoff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("/api/compliance/history")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.startsWith("/api/compliance")) {
        return {
          ok: true,
          json: async () => ({
            standard: "SOC 2 Type II",
            generatedAt: "2026-11-24T10:00:00.000Z",
            totalControls: 1,
            passingControls: 0,
            failingControls: 1,
            warningControls: 0,
            suppressedControls: 0,
            score: 0,
            categories: [
              {
                id: "gcp:CC6",
                name: "Logical and Physical Access Controls",
                description: "Access controls",
                controls: [
                  {
                    id: "gcp:CC6.1.a",
                    title: "No Public Storage Buckets",
                    description: "Buckets must not grant public IAM access.",
                    status: "fail",
                    impact: "critical",
                    evidence: [{ name: "public-assets", projectId: "theinsite-prod" }],
                    remediationHint: "Remove allUsers from bucket IAM bindings.",
                  },
                ],
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

  it("opens RemediateModal from Create PR and PushToCliModal from Send to CLI", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("No Public Storage Buckets")).toBeInTheDocument();
    });

    const createPrButtons = screen.getAllByRole("button", { name: /create pr/i });
    expect(createPrButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(createPrButtons[0]);
    expect(await screen.findByText(/Select findings or attack paths to remediate/i)).toBeInTheDocument();
    expect(screen.getByText("CC6.1.a: No Public Storage Buckets")).toBeInTheDocument();

    // Close RemediateModal if close button exists, or open Send to CLI in a clean render
    const closeBtn = screen.queryByRole("button", { name: /close/i });
    if (closeBtn) fireEvent.click(closeBtn);

    const sendToCliButtons = screen.getAllByRole("button", { name: /send to cli/i });
    expect(sendToCliButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(sendToCliButtons[0]);
    expect(await screen.findByText(/Send SOC 2 Compliance Controls to CLI Task Queue/i)).toBeInTheDocument();
  });
});
