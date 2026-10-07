/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getSessionThinkingDetailApi } from "../chat/chatApi.js";

export const THINKING_DETAIL_NOT_FOUND = "thinking_detail_not_found";
export const THINKING_DETAIL_REQUEST_FAILED = "thinking_detail_request_failed";

let authenticatedFetcher = null;

function assertThinkingDetailPayload(data) {
  const payload = data || {};
  if (payload.ok && payload.exists) return payload;
  const error = new Error(payload.error || "thinking detail not found");
  if (payload.ok) error.code = THINKING_DETAIL_NOT_FOUND;
  error.serverMessage = String(payload.error || "");
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
      const status = response?.status || 500;
      const error = new Error(`failed to load thinking detail: ${status}`);
      error.code = THINKING_DETAIL_REQUEST_FAILED;
      error.status = status;
      throw error;
    }
    return assertThinkingDetailPayload(await response.json());
  },
});
