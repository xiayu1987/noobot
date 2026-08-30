/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createThinkingDetailService(authenticatedRequest) {
  if (typeof authenticatedRequest !== "function") return null;
  return Object.freeze({
    getDetail({ userId = "", sessionId = "", dialogProcessId = "", turnScopeId = "" } = {}) {
      const query = new URLSearchParams();
      if (String(dialogProcessId).trim())
        query.set("dialogProcessId", String(dialogProcessId).trim());
      if (String(turnScopeId).trim()) query.set("turnScopeId", String(turnScopeId).trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return authenticatedRequest(
        `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/thinking-detail${suffix}`,
        { method: "GET" },
      );
    },
  });
}
