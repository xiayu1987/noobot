/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { validateTurnUserMessageEventData } from "./transport/turn-user-message-event.js";

/** Session command commit receipt wire event. This is not a lifecycle fact. */
export const TURN_COMMITTED_WIRE_EVENT = "turn_committed";

export function validateTurnCommittedEventData(data = {}) {
  return validateTurnUserMessageEventData(data, { attachmentMode: "forbidden" });
}

export function assertTurnCommittedEventData(data = {}) {
  const validation = validateTurnCommittedEventData(data);
  if (validation.ok) return data;
  const error = new TypeError(`invalid turn_committed event: ${validation.errors.join(",")}`);
  error.code = "TURN_COMMITTED_PROTOCOL_INVALID";
  error.validationErrors = validation.errors;
  throw error;
}
