/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_CHANNEL_STATE, FrontendRunState } from "./constants.js";
import { text } from "@noobot/shared/value";

export function trim(value = "") {
  return text(value);
}

export function normalizeState(state = "") {
  const value = trim(state).toLowerCase();
  if (value === "running") return AGENT_CHANNEL_STATE.SENDING;
  if (value === "completed") return AGENT_CHANNEL_STATE.COMPLETED;
  if (value === "cancelled") return FrontendRunState.CANCELLED;
  return [...Object.values(AGENT_CHANNEL_STATE), ...Object.values(FrontendRunState)].includes(value)
    ? value
    : "";
}
