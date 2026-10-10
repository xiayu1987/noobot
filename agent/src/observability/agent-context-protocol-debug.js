/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";

export function emitAgentContextProtocolDebug(eventListener, event, data = {}) {
  return emitEvent(eventListener, `agent.contextProtocol.${String(event || "observed").trim()}`, {
    protocolVersion: 2,
    ...data,
  });
}
