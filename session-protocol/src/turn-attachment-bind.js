/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTurnUserMessageEventProtocol } from "./transport/turn-user-message-event.js";

export const TURN_ATTACHMENTS_BOUND_WIRE_EVENT = "turn_attachments_bound";

const protocol = createTurnUserMessageEventProtocol({
  wireEvent: TURN_ATTACHMENTS_BOUND_WIRE_EVENT,
  attachmentMode: "required",
  errorCode: "TURN_ATTACHMENTS_BOUND_PROTOCOL_INVALID",
});

export function validateTurnAttachmentsBoundEventData(data = {}) {
  return protocol.validate(data);
}

export function assertTurnAttachmentsBoundEventData(data = {}) {
  return protocol.assert(data);
}
