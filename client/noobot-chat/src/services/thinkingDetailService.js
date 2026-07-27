/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSessionThinkingDetailApi } from "./api/chatApi.js";

let authenticatedFetcher = null;

/** Host-owned service for the single thinking-detail read operation. */
export const thinkingDetailService = Object.freeze({
  configure({ fetcher = null } = {}) {
    authenticatedFetcher = typeof fetcher === "function" ? fetcher : null;
  },
  async getDetail({ userId = "", sessionId = "", dialogProcessId = "", turnScopeId = "" } = {}) {
    const response = await getSessionThinkingDetailApi(
      { userId, sessionId, dialogProcessId, turnScopeId },
      authenticatedFetcher ? { fetcher: authenticatedFetcher } : {},
    );
    if (!response?.ok) throw new Error(`failed to load thinking detail: ${response?.status || 500}`);
    const data = await response.json();
    if (!data?.ok || !data?.exists) throw new Error(data?.error || "thinking detail not found");
    return data;
  },
});
