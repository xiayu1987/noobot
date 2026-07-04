/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { BackendChannelState, BackendTerminalStates, FrontendRunState } from "../sessionRunStateMachine";
import { _trimStr } from "./utils";

export function isInFlightConversationState(state = "") {
  return [
    BackendChannelState.SENDING,
    BackendChannelState.INTERACTION_PENDING,
    BackendChannelState.STOPPING,
    BackendChannelState.RECONNECTING,
  ].includes(_trimStr(state));
}

export function isTerminalConversationState(state = "") {
  return [
    ...BackendTerminalStates,
    FrontendRunState.CANCELLED,
  ].includes(_trimStr(state));
}
