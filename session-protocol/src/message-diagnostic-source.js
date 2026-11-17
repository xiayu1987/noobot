/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalSessionId } from "./identity.js";
export const MESSAGE_DIAGNOSTIC_SOURCE = "session.messages";

export function requireMessageDiagnosticSource(identity) {
  if (
    !Array.isArray(identity) ||
    identity.length !== 3 ||
    identity[0] !== MESSAGE_DIAGNOSTIC_SOURCE ||
    !isCanonicalSessionId(identity[1]) ||
    !Number.isSafeInteger(identity[2]) ||
    identity[2] < 1
  )
    throw new TypeError("Invalid message diagnostic source position");
  return identity;
}

export function messageDiagnosticSourceId(sessionId, sequence) {
  return JSON.stringify(
    requireMessageDiagnosticSource([MESSAGE_DIAGNOSTIC_SOURCE, sessionId, sequence]),
  );
}
