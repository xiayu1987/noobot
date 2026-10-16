/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_CHANNEL_STATE, BackendTerminalStates, FrontendRunState } from "./constants.js";
import { normalizeState } from "./normalize.js";

const CHANNEL_IN_FLIGHT_STATES = Object.freeze([
  AGENT_CHANNEL_STATE.SENDING,
  AGENT_CHANNEL_STATE.INTERACTION_PENDING,
  AGENT_CHANNEL_STATE.STOPPING,
  AGENT_CHANNEL_STATE.RECONNECTING,
]);

const CHANNEL_TERMINAL_STATES = Object.freeze([
  ...BackendTerminalStates,
  FrontendRunState.CANCELLED,
]);

const CHANNEL_IN_FLIGHT_STATE_SET = new Set(CHANNEL_IN_FLIGHT_STATES);
const CHANNEL_TERMINAL_STATE_SET = new Set(CHANNEL_TERMINAL_STATES);

export function isInFlightChannelState(state = "") {
  return CHANNEL_IN_FLIGHT_STATE_SET.has(normalizeState(state));
}

export function isTerminalChannelState(state = "") {
  return CHANNEL_TERMINAL_STATE_SET.has(normalizeState(state));
}
