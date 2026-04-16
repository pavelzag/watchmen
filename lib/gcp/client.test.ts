/** @jest-environment node */

import { getGcpScanWarnings, logFetchWarning, resetGcpScanWarnings } from "./client";

describe("GCP scan warning classification", () => {
  beforeEach(() => {
    resetGcpScanWarnings();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("handles Google API errors with numeric codes", () => {
    const warning = logFetchWarning("bigquery", "gen-lang-client-0760991201", {
      code: 403,
      message: "Forbidden",
    });

    expect(warning.code).toBe("permission_denied");
    expect(warning.message).toContain("bigquery skipped for gen-lang-client-0760991201");
    expect(getGcpScanWarnings()).toHaveLength(1);
  });
});
