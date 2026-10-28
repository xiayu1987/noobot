/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";
import { normalizeDialogProcessId } from "../identity.js";

const TURN_TIMING_FACT_FIELDS = Object.freeze(["thinkingFinishedAt", "modelLoopRound"]);
const TURN_TIMING_RECORD_FIELDS = Object.freeze([
  "turnScopeId",
  "dialogProcessId",
  ...TURN_TIMING_FACT_FIELDS,
]);

function timingError(code, message) {
  return Object.assign(new TypeError(message), { code });
}

function normalizeModelLoopRound(value) {
  if (value === undefined || value === null || value === 0) return 0;
  if (Number.isInteger(value) && value > 0) return value;
  throw timingError(SESSION_ERROR_CODE.TURN_TIMING_INVALID, "turn timing modelLoopRound invalid");
}

export function normalizeTurnTimingRecord(record) {
  if (!isPlainObject(record)) {
    throw timingError(SESSION_ERROR_CODE.TURN_TIMING_INVALID, "turn timing must be an object");
  }
  const unknownField = Object.keys(record).find(
    (field) => !TURN_TIMING_RECORD_FIELDS.includes(field),
  );
  if (unknownField) {
    throw timingError(
      SESSION_ERROR_CODE.TURN_TIMING_INVALID,
      `turn timing field not allowed: ${unknownField}`,
    );
  }
  const turnScopeId = clean(record.turnScopeId);
  if (!turnScopeId) {
    throw timingError(SESSION_ERROR_CODE.TURN_TIMING_INVALID, "turn timing turnScopeId required");
  }
  const dialogProcessId = normalizeDialogProcessId(record.dialogProcessId);
  if (!dialogProcessId) {
    throw timingError(
      SESSION_ERROR_CODE.TURN_TIMING_INVALID,
      `turn timing dialogProcessId required: ${turnScopeId}`,
    );
  }
  const thinkingFinishedAt = clean(record.thinkingFinishedAt);
  const modelLoopRound = normalizeModelLoopRound(record.modelLoopRound);
  if (!thinkingFinishedAt && !modelLoopRound) {
    throw timingError(
      SESSION_ERROR_CODE.TURN_TIMING_INVALID,
      `turn timing has no timing fact: ${turnScopeId}`,
    );
  }
  return {
    turnScopeId,
    dialogProcessId,
    ...(thinkingFinishedAt ? { thinkingFinishedAt } : {}),
    ...(modelLoopRound ? { modelLoopRound } : {}),
  };
}

export function mergeTurnTimingRecord(existing, incoming) {
  const current = normalizeTurnTimingRecord(existing);
  const next = normalizeTurnTimingRecord(incoming);
  const conflict =
    current.turnScopeId !== next.turnScopeId ||
    current.dialogProcessId !== next.dialogProcessId ||
    TURN_TIMING_FACT_FIELDS.some(
      (field) =>
        Object.hasOwn(current, field) &&
        Object.hasOwn(next, field) &&
        current[field] !== next[field],
    );
  if (conflict) {
    throw timingError(
      SESSION_ERROR_CODE.TURN_TIMING_CONFLICT,
      `turn timing conflicts with recorded fact: ${current.turnScopeId}`,
    );
  }
  return { ...current, ...next };
}

export function assertTurnTimingOwnership(timing, ownerDialogProcessId) {
  const recordedOwner = normalizeDialogProcessId(ownerDialogProcessId);
  if (!recordedOwner || recordedOwner === timing.dialogProcessId) return;
  throw timingError(
    SESSION_ERROR_CODE.TURN_TIMING_CONFLICT,
    `turn timing dialogProcessId conflicts with turn owner: ${timing.turnScopeId}`,
  );
}

function findTurnTiming(turnScopeId, timings) {
  return timings.find((item) => isPlainObject(item) && clean(item.turnScopeId) === turnScopeId);
}

export function projectTurnTiming(turn = {}, timings = []) {
  const timing = findTurnTiming(clean(turn.turnScopeId), timings);
  return {
    ...turn,
    thinkingFinishedAt: clean(timing?.thinkingFinishedAt),
  };
}
