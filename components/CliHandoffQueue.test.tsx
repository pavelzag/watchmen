import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CliHandoffQueue from "./CliHandoffQueue";

jest.mock("@/components/DemoModeProvider", () => ({
  useDemoMode: () => false,
}));

describe("CliHandoffQueue", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("allows multi-selecting Critical, High, and Medium severities without extra preset buttons", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tasks: [],
        summary: {
          total: 10,
          countsBySeverity: { critical: 2, high: 3, medium: 4, low: 1 },
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<CliHandoffQueue />);

    const critBtn = await screen.findByRole("button", { name: /^Critical \(2\)/i });

    expect(screen.queryByText(/Crit \+ High \+ Med/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Crit \+ Med/i)).not.toBeInTheDocument();

    fireEvent.click(critBtn);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("severity=critical")
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /^Medium \(4\)/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("severity=critical%2Cmedium")
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /^High \(3\)/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("severity=critical%2Cmedium%2Chigh")
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /^All Severities \(10\)/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("severity=all")
      );
    });
  });
});
