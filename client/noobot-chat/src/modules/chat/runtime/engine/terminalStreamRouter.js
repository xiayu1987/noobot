/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";

export function routeTerminalStreamEvent(event, data, context) {
  if (event === StreamEventEnum.CHANNEL_STATE) {
    // Channel state is transport observation only. Authority lifecycle
    // envelopes/snapshots are the sole source of run state and terminal facts.
    return true;
  }
  return false;
}
