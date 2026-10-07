/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSessionExecutionReportApi } from "../chat/chatApi.js";

let authenticatedFetcher = null;

export const executionReportService = Object.freeze({
  configure({ fetcher = null } = {}) {
    authenticatedFetcher = typeof fetcher === "function" ? fetcher : null;
  },
  async getReport({ userId = "", sessionId = "", dialogProcessId = "" } = {}) {
    const response = await getSessionExecutionReportApi(
      { userId, sessionId, dialogProcessId },
      authenticatedFetcher ? { fetcher: authenticatedFetcher } : {},
    );
    if (response?.status === 404) return null;
    if (!response?.ok) {
      throw new Error(`failed to load execution report: ${response?.status || 500}`);
    }
    const payload = (await response.json()) || {};
    if (!payload.ok) throw new Error(payload.error || "failed to load execution report");
    return payload.report || null;
  },
});
