/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  PENDING_COMMAND_STATUS_STEP,
  STATUS_STEP_LABEL_KEY,
  STATUS_STEP_STAGE,
  STATUS_STEP_STAGE_BLOCKING_SEND,
  STATUS_STEP_STAGE_ORDINAL,
  STATUS_STEP_STAGE_SEQUENCE,
  STATUS_STEP_TERMINAL,
  TURN_TERMINAL_STATUS_STEP,
} from "./constants.js";

const STAGE_STATES = new Set(Object.values(STATUS_STEP_STAGE));
const TERMINAL_STATES = new Set(Object.values(STATUS_STEP_TERMINAL));
const SEND_BLOCKING_STATES = new Set(STATUS_STEP_STAGE_BLOCKING_SEND);

function normalize(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function normalizeStatusStepState(value = "") {
  const normalized = normalize(value);
  return STAGE_STATES.has(normalized) || TERMINAL_STATES.has(normalized) ? normalized : "";
}

export function isTerminalStatusStepState(value = "") {
  return TERMINAL_STATES.has(normalize(value));
}

export function isStageStatusStepState(value = "") {
  return STAGE_STATES.has(normalize(value));
}

export function isSendBlockingStatusStepState(value = "") {
  return SEND_BLOCKING_STATES.has(normalize(value));
}

export function resolvePendingCommandStatusStep(pendingCommandType = "") {
  return PENDING_COMMAND_STATUS_STEP[normalize(pendingCommandType)] || "";
}

export function resolveTurnTerminalStatusStep(turnTerminal = "") {
  return TURN_TERMINAL_STATUS_STEP[normalize(turnTerminal)] || "";
}

export function resolveStatusStepStageOrdinal(value = "") {
  const normalized = normalizeStatusStepState(value);
  if (!normalized) return -1;
  if (TERMINAL_STATES.has(normalized)) return STATUS_STEP_STAGE_SEQUENCE.length + 1;
  const ordinal = STATUS_STEP_STAGE_ORDINAL[normalized];
  return ordinal === undefined ? -1 : ordinal;
}

export function resolveStatusStepLabelKey(value = "") {
  return STATUS_STEP_LABEL_KEY[normalizeStatusStepState(value)] || "";
}

export { STATUS_STEP_STAGE, STATUS_STEP_STAGE_SEQUENCE, STATUS_STEP_TERMINAL };
