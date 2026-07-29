/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function routeWorkflowDiagnosticsPayload(parentSessionIdValue, payload = {}) {
  const parentSessionId = String(parentSessionIdValue || "").trim();
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const payloadSessionId = String(safePayload.sessionId || "").trim();
  return {
    ...safePayload,
    ...(payloadSessionId && payloadSessionId !== parentSessionId
      ? { nodeSessionId: payloadSessionId }
      : {}),
    sessionId: parentSessionId || payloadSessionId,
  };
}
