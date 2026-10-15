/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function routeWorkflowDiagnosticsPayload(parentSessionIdValue, payload = {}) {
  const parentSessionId = text(parentSessionIdValue);
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const payloadSessionId = text(safePayload.sessionId);
  return {
    ...safePayload,
    ...(payloadSessionId && payloadSessionId !== parentSessionId
      ? { nodeSessionId: payloadSessionId }
      : {}),
    sessionId: parentSessionId || payloadSessionId,
  };
}
