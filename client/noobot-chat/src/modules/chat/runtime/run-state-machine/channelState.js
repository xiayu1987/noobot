/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BackendChannelState, BackendTerminalStates, FrontendRunState } from "./constants.js";
import { normalizeState } from "./normalize.js";

export const CHANNEL_IN_FLIGHT_STATES = Object.freeze([
  BackendChannelState.SENDING,
  BackendChannelState.INTERACTION_PENDING,
  BackendChannelState.STOPPING,
  BackendChannelState.RECONNECTING,
]);

export const CHANNEL_TERMINAL_STATES = Object.freeze([
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
