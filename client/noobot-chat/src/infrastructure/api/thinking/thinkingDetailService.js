/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSessionThinkingDetailApi } from "../chat/chatApi.js";

let authenticatedFetcher = null;

function assertThinkingDetailPayload(data) {
  const payload = data || {};
  if (payload.ok && payload.exists) return payload;
  const error = new Error(payload.error || "thinking detail not found");
  if (payload.ok) error.code = "thinking_detail_not_found";
  throw error;
}

export const thinkingDetailService = Object.freeze({
  configure({ fetcher = null } = {}) {
    authenticatedFetcher = typeof fetcher === "function" ? fetcher : null;
  },
  async getDetail({ userId = "", sessionId = "", dialogProcessId = "", turnScopeId = "" } = {}) {
    const response = await getSessionThinkingDetailApi(
      { userId, sessionId, dialogProcessId, turnScopeId },
      authenticatedFetcher ? { fetcher: authenticatedFetcher } : {},
    );
    if (!response?.ok) {
      throw new Error(`failed to load thinking detail: ${response?.status || 500}`);
    }
    return assertThinkingDetailPayload(await response.json());
  },
});
