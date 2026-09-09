/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createTurnUserMessageEventProtocol } from "./transport/turn-user-message-event.js";

export const TURN_COMMITTED_WIRE_EVENT = "turn_committed";

const protocol = createTurnUserMessageEventProtocol({
  wireEvent: TURN_COMMITTED_WIRE_EVENT,
  attachmentMode: "forbidden",
  errorCode: "TURN_COMMITTED_PROTOCOL_INVALID",
});

export function validateTurnCommittedEventData(data = {}) {
  return protocol.validate(data);
}

export function assertTurnCommittedEventData(data = {}) {
  return protocol.assert(data);
}
