/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildExecutionReport } from "@noobot/session-protocol/execution-report";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_REQUEST_ERROR_CODE, ApiRequestError } from "@noobot/shared/request-error";
import { configureAuthenticatedFetcher } from "../../../../src/infrastructure/http/authenticatedHttpService.js";

const getSessionExecutionReportApi = vi.fn();
const fetcher = vi.fn();
vi.mock("../../../../src/infrastructure/api/chat/chatApi.js", () => ({
  getSessionExecutionReportApi: (...args) => getSessionExecutionReportApi(...args),
}));

const { executionReportService } =
  await import("../../../../src/infrastructure/api/thinking/executionReportService.js");

const identity = { userId: "u1", sessionId: "s1", dialogProcessId: "dp-1" };

function apiError(message, { code, status, serverErrorCode }) {
  return new ApiRequestError(message, { code, status, serverErrorCode });
}

describe("executionReportService.getReport", () => {
  beforeEach(() => {
    getSessionExecutionReportApi.mockReset();
    configureAuthenticatedFetcher(fetcher);
  });

  it("returns the report and forwards identity plus configured fetcher", async () => {
    const report = buildExecutionReport({
      status: "completed",
      sessionId: "s1",
      dialogProcessId: "dp-1",
      summaryError: { message: "summary unavailable" },
    });
    getSessionExecutionReportApi.mockResolvedValue({ ok: true, report });
    await expect(executionReportService.getReport(identity)).resolves.toEqual(report);
    expect(getSessionExecutionReportApi).toHaveBeenCalledWith(identity, { fetcher });
  });

  it("returns null when the report has not been generated (404)", async () => {
    getSessionExecutionReportApi.mockRejectedValue(
      apiError("not found", {
        code: API_REQUEST_ERROR_CODE.NOT_FOUND,
        status: 404,
        serverErrorCode: "",
      }),
    );
    await expect(executionReportService.getReport(identity)).resolves.toBeNull();
  });

  it("rejects reports that violate the execution report protocol", async () => {
    getSessionExecutionReportApi.mockResolvedValue({
      ok: true,
      report: { status: "completed", dialogProcessId: "dp-1" },
    });
    await expect(executionReportService.getReport(identity)).rejects.toMatchObject({
      code: "EXECUTION_REPORT_INVALID",
    });
  });

  it("rethrows other API failures with server error, status and errorCode", async () => {
    const failure = apiError("missing_persistence_scope", {
      code: API_REQUEST_ERROR_CODE.HTTP,
      status: 400,
      serverErrorCode: "SESSION_SCOPE_INVALID",
    });
    getSessionExecutionReportApi.mockRejectedValue(failure);
    await expect(executionReportService.getReport(identity)).rejects.toBe(failure);
  });
});
