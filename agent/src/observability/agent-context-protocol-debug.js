/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { emitEvent } from "../events/index.js";
import { text } from "@noobot/shared/value";

export function emitAgentContextProtocolDebug(eventListener, event, data = {}) {
  return emitEvent(eventListener, `agent.contextProtocol.${text(event) || "observed"}`, {
    protocolVersion: 2,
    ...data,
  });
}
