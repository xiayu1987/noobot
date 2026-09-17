/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createThinkingDetailService(authenticatedRequest) {
  if (typeof authenticatedRequest !== "function") return null;
  return Object.freeze({
    async getDetail({ userId = "", sessionId = "", dialogProcessId = "", turnScopeId = "" } = {}) {
      const query = new URLSearchParams();
      if (String(dialogProcessId).trim())
        query.set("dialogProcessId", String(dialogProcessId).trim());
      if (String(turnScopeId).trim()) query.set("turnScopeId", String(turnScopeId).trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      const response = await authenticatedRequest(
        `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/thinking-detail${suffix}`,
        { method: "GET" },
      );
      if (!response?.ok) {
        throw new Error(`failed to load thinking detail: ${response?.status || 500}`);
      }
      const data = await response.json();
      if (!data?.ok || !data?.exists) {
        const error = new Error(data?.error || "thinking detail not found");
        if (data?.ok && !data?.exists) error.code = "thinking_detail_not_found";
        throw error;
      }
      return data;
    },
  });
}
