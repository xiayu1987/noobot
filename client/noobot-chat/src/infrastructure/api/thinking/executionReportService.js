/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { decodeExecutionReport } from "@noobot/session-protocol/execution-report";
import { isApiRequestNotFound } from "@noobot/shared/request-error";
import { getSessionExecutionReportApi } from "../chat/chatApi.js";
import { requireAuthenticatedFetcher } from "../../http/authenticatedHttpService.js";

export const executionReportService = Object.freeze({
  async getReport({ userId, sessionId, dialogProcessId }) {
    let payload;
    try {
      payload = await getSessionExecutionReportApi(
        { userId, sessionId, dialogProcessId },
        { fetcher: requireAuthenticatedFetcher() },
      );
    } catch (error) {
      if (isApiRequestNotFound(error)) return null;
      throw error;
    }
    return decodeExecutionReport(payload.report);
  },
});
