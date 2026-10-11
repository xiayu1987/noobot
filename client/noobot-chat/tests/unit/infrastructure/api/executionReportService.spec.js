/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildExecutionReport } from "@noobot/session-protocol/execution-report";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionExecutionReportApi = vi.fn();
vi.mock("../../../../src/infrastructure/api/chat/chatApi.js", () => ({
  getSessionExecutionReportApi: (...args) => getSessionExecutionReportApi(...args),
}));

const { executionReportService } =
  await import("../../../../src/infrastructure/api/thinking/executionReportService.js");

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

describe("executionReportService.getReport", () => {
  beforeEach(() => {
    getSessionExecutionReportApi.mockReset();
    executionReportService.configure({ fetcher: null });
  });

  it("returns the report and forwards identity plus configured fetcher", async () => {
    const fetcher = vi.fn();
    executionReportService.configure({ fetcher });
    const report = buildExecutionReport({
      status: "completed",
      sessionId: "s1",
      dialogProcessId: "dp-1",
      summaryError: { message: "summary unavailable" },
    });
    getSessionExecutionReportApi.mockResolvedValue(jsonResponse({ ok: true, report }));
    await expect(
      executionReportService.getReport({ userId: "u1", sessionId: "s1", dialogProcessId: "dp-1" }),
    ).resolves.toEqual(report);
    expect(getSessionExecutionReportApi).toHaveBeenCalledWith(
      { userId: "u1", sessionId: "s1", dialogProcessId: "dp-1" },
      { fetcher },
    );
  });

  it("returns null when the report has not been generated (404)", async () => {
    getSessionExecutionReportApi.mockResolvedValue(jsonResponse({}, { ok: false, status: 404 }));
    await expect(executionReportService.getReport()).resolves.toBeNull();
  });

  it("rejects reports that violate the execution report protocol", async () => {
    getSessionExecutionReportApi.mockResolvedValue(
      jsonResponse({ ok: true, report: { status: "completed", dialogProcessId: "dp-1" } }),
    );
    await expect(executionReportService.getReport()).rejects.toMatchObject({
      code: "EXECUTION_REPORT_INVALID",
    });
  });

  it("throws with the HTTP status for other failures", async () => {
    getSessionExecutionReportApi.mockResolvedValue(jsonResponse({}, { ok: false, status: 400 }));
    await expect(executionReportService.getReport()).rejects.toThrow(
      "failed to load execution report: 400",
    );
  });

  it("surfaces the server error when ok is false", async () => {
    getSessionExecutionReportApi.mockResolvedValue(jsonResponse({ ok: false, error: "denied" }));
    await expect(executionReportService.getReport()).rejects.toThrow("denied");
  });
});
