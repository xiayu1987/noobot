/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";

export const AGENT_CONTEXT_PROTOCOL_DEBUG_TYPE = "agent-context-protocol";

export function emitAgentContextProtocolDebug(eventListener, event, identity = {}, data = {}) {
  return emitEvent(eventListener, `agent.contextProtocol.${String(event || "observed").trim()}`, {
    debugType: AGENT_CONTEXT_PROTOCOL_DEBUG_TYPE,
    protocolVersion: 2,
    userId: String(identity?.userId || "").trim(),
    sessionId: String(identity?.sessionId || "").trim(),
    dialogProcessId: String(identity?.dialogProcessId || "").trim(),
    turnScopeId: String(identity?.turnScopeId || "").trim(),
    ...(data && typeof data === "object" ? data : {}),
  });
}
