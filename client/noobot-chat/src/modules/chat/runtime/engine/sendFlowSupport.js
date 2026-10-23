/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageTurnScopeId } from "../../model/messageIdentity.js";
import {
  resolveSessionTurnRuntime,
  sessionRuntimeId,
  turnRuntimeDisplayState,
} from "../run-state-machine/turnRuntimeRegistry.js";
import { isStageStatusStepState } from "../run-state-machine/statusStep.js";
import { normalizeTrimmedString } from "./utils.js";
import { createSecureId } from "@noobot/shared/secure-identity";

export function createTurnScopeId() {
  return createSecureId("client-turn");
}

export function isEventForCurrentTurn(data = {}, botMessage = {}) {
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  return normalizeTrimmedString(data?.turnScopeId) === botTurnScopeId;
}

export function hasActiveTurnInFlight({ activeSession, turnRuntimeRegistry } = {}) {
  const sessionId = sessionRuntimeId(activeSession?.value);
  const turn = resolveSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId);
  return isStageStatusStepState(turnRuntimeDisplayState(turn));
}
