/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
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

export function shouldProjectSubSessionEvent(event = "", data = {}) {
  if (event !== MESSAGE_EVENT_WIRE_EVENT) return false;
  const result = validateProtocolEvent(data);
  return (
    result.valid &&
    result.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE &&
    Boolean(data?.payload?.workflowRunId && data?.payload?.nodeExecutionId)
  );
}

export function shouldProjectMainSessionEvent(event = "", data = {}) {
  if (event !== MESSAGE_EVENT_WIRE_EVENT) return false;
  const result = validateProtocolEvent(data);
  return (
    result.valid &&
    result.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE &&
    !data?.payload?.workflowRunId &&
    !data?.payload?.nodeExecutionId
  );
}
