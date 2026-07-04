/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { _trimStr } from "./utils";

export function isInFlightConversationState(state = "") {
  return ["sending", "interaction_pending", "stopping", "reconnecting"].includes(
    _trimStr(state),
  );
}

export function isTerminalConversationState(state = "") {
  return [
    "stopped",
    "completed",
    "error",
    "no_conversation",
    "expired",
    "cancelled",
  ].includes(_trimStr(state));
}
