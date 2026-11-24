import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PushToCliModal from "./PushToCliModal";
import type { HandoffIssueItem } from "@/lib/handoff/tasks";

jest.mock("@/components/DemoModeProvider", () => ({
  useDemoMode: () => false,
}));

const SAMPLE_ISSUES: HandoffIssueItem[] = [
  {
    id: "public_firewall:proj-1:allow-ssh",
    kind: "finding",
    cloud: "gcp",
    severity: "critical",
    title: "Firewall Rule Open to the Internet",
    description: "Allows 0.0.0.0/0 on port 22",
    resourceName: "allow-ssh",
    resourceType: "firewall_rule",
    projectId: "proj-1",
    remediationHint: "Restrict sourceRanges",
  },
  {
    id: "public_bucket:proj-1:logs",
    kind: "finding",
    cloud: "gcp",
    severity: "high",
    title: "Publicly Accessible Storage Bucket",
    description: "allUsers bound",
    resourceName: "logs",
    resourceType: "storage_bucket",
    projectId: "proj-1",
    remediationHint: "Remove allUsers",
  },
];

describe("PushToCliModal", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("groups issues, switches CLI adapters, and pushes tasks to /api/handoff/tasks", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        createdCount: 2,
        updatedCount: 0,
        tasks: [
          {
            id: "wm_tsk_fw",
            title: "Firewall issues",
            severity: "critical",
            issueCount: 1,
            promptMarkdown: "# Firewall",
          },
          {
            id: "wm_tsk_st",
            title: "Storage issues",
            severity: "high",
            issueCount: 1,
            promptMarkdown: "# Storage",
          },
        ],
      }),
    }) as unknown as typeof fetch;

    render(
      <PushToCliModal
        isOpen
        onClose={jest.fn()}
        issues={SAMPLE_ISSUES}
        contextLabel="SOC 2 Compliance Controls"
      />
    );

    expect(screen.getByText(/Send SOC 2 Compliance Controls to CLI Task Queue/i)).toBeInTheDocument();
    expect(screen.getByText(/2 issues → 2 tasks/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Claude Code"));
    fireEvent.click(screen.getByText("Push to Watchmen Queue"));

    await waitFor(() => {
      expect(screen.getByText(/Queued 2 tasks \(2 created, 0 updated\)/i)).toBeInTheDocument();
    });

    expect(screen.getByText("wm_tsk_fw")).toBeInTheDocument();
    expect(screen.getAllByText(/watchmen_get_task/i).length).toBe(2);

    fireEvent.click(screen.getByText("REST API"));
    expect(screen.getByText(/\/api\/handoff\/tasks\/wm_tsk_fw/i)).toBeInTheDocument();
  });

  it("supports switching to Shirudo Live Shield mode and sends remediationMode to /api/handoff/tasks", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        createdCount: 1,
        updatedCount: 0,
        tasks: [
          {
            id: "wm_tsk_shld",
            title: "[Shirudo Shield] Container image vulnerabilities",
            severity: "critical",
            issueCount: 1,
            promptMarkdown: "# Watchmen Shirudo Shield Task",
          },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <PushToCliModal
        isOpen
        onClose={jest.fn()}
        issues={[
          {
            id: "container-cve:gcp:proj-1:api:CVE-2026-1234:openssl",
            kind: "container_cve",
            cloud: "gcp",
            severity: "critical",
            title: "CVE-2026-1234: openssl 3.5.1 -> 3.5.2",
            description: "Buffer overflow in TLS parser",
            resourceName: "api",
            resourceType: "container_image",
            projectId: "proj-1",
          },
        ]}
        contextLabel="Container CVEs"
      />
    );

    fireEvent.click(screen.getByText("Shirudo Live Shield"));
    expect(screen.getByText(/ML-DSA-87 signing keys stay on your operator\/CI host/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Push to Watchmen Queue"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(String(requestInit.body)) as { remediationMode?: string };
    expect(sentBody.remediationMode).toBe("shirudo_shield");
  });
});
