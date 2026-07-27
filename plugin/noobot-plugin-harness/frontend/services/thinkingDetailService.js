/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createThinkingDetailService(authenticatedGet) {
  if (typeof authenticatedGet !== "function") return null;
  return Object.freeze({
    getDetail({ userId = "", sessionId = "", dialogProcessId = "", turnScopeId = "" } = {}) {
      const query = new URLSearchParams();
      if (String(dialogProcessId).trim()) query.set("dialogProcessId", String(dialogProcessId).trim());
      if (String(turnScopeId).trim()) query.set("turnScopeId", String(turnScopeId).trim());
      const suffix = query.size ? `?${query.toString()}` : "";
      return authenticatedGet(
        `/api/internal/session/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/thinking-detail${suffix}`,
      );
    },
  });
}
