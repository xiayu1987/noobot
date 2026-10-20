/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { decodeExecutionReport } from "@noobot/session-protocol/execution-report";
import { getSessionExecutionReportApi } from "../chat/chatApi.js";

let authenticatedFetcher = null;

export const executionReportService = Object.freeze({
  configure({ fetcher = null } = {}) {
    authenticatedFetcher = typeof fetcher === "function" ? fetcher : null;
  },
  async getReport({ userId = "", sessionId = "", dialogProcessId = "" } = {}) {
    let payload;
    try {
      payload = await getSessionExecutionReportApi(
        { userId, sessionId, dialogProcessId },
        authenticatedFetcher ? { fetcher: authenticatedFetcher } : {},
      );
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
    return decodeExecutionReport(payload.report);
  },
});
