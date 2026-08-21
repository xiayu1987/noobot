/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateTurnUserMessageEventData } from "./transport/turn-user-message-event.js";

export const TURN_ATTACHMENTS_BOUND_WIRE_EVENT = "turn_attachments_bound";

export function validateTurnAttachmentsBoundEventData(data = {}) {
  return validateTurnUserMessageEventData(data, { attachmentMode: "required" });
}

export function assertTurnAttachmentsBoundEventData(data = {}) {
  const validation = validateTurnAttachmentsBoundEventData(data);
  if (validation.ok) return data;
  const error = new TypeError(
    `invalid turn_attachments_bound event: ${validation.errors.join(",")}`,
  );
  error.code = "TURN_ATTACHMENTS_BOUND_PROTOCOL_INVALID";
  error.validationErrors = validation.errors;
  throw error;
}
