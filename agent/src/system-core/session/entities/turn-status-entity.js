/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";

export const TURN_STATUS = Object.freeze({
  COMPLETED: "completed",
  USER_STOPPED: "user_stopped",
  ERROR: "error",
  TIMEOUT: "timeout",
});

export const TURN_STATUS_REASON = Object.freeze({
  RUN_COMPLETED: "run_completed",
  USER_STOP: "user_stop",
  RUN_ERROR: "run_error",
  RUN_ABORTED: "run_aborted",
  RUN_TIMEOUT: "run_timeout",
});

export const TURN_TERMINAL_COMMAND = Object.freeze({
  COMPLETED: "completed",
  USER_STOPPED: "user_stopped",
  ERROR: "error",
  ABORTED: "aborted",
  TIMEOUT: "timeout",
});

const TERMINAL = new Set(Object.values(TURN_STATUS));
const REASONS_BY_STATUS = Object.freeze({
  [TURN_STATUS.COMPLETED]: new Set([TURN_STATUS_REASON.RUN_COMPLETED]),
  [TURN_STATUS.USER_STOPPED]: new Set([TURN_STATUS_REASON.USER_STOP]),
  [TURN_STATUS.ERROR]: new Set([TURN_STATUS_REASON.RUN_ERROR, TURN_STATUS_REASON.RUN_ABORTED]),
  [TURN_STATUS.TIMEOUT]: new Set([TURN_STATUS_REASON.RUN_TIMEOUT]),
});

function text(value = "") { return String(value || "").trim(); }

function plainError(error = null) {
  if (!error) return null;
  if (typeof error === "string") return { message: error };
  if (typeof error !== "object" || Array.isArray(error)) return { message: String(error) };
  return Object.fromEntries(Object.entries({
    name: text(error.name),
    message: text(error.message || error.error),
    code: text(error.code),
    stack: text(error.stack),
  }).filter(([, v]) => v));
}

export function buildTurnTerminalCommand(command = "", payload = {}) {
  const normalizedCommand = text(command).toLowerCase();
  const contract = {
    [TURN_TERMINAL_COMMAND.COMPLETED]: [TURN_STATUS.COMPLETED, TURN_STATUS_REASON.RUN_COMPLETED, "本轮对话已正常完成"],
    [TURN_TERMINAL_COMMAND.USER_STOPPED]: [TURN_STATUS.USER_STOPPED, TURN_STATUS_REASON.USER_STOP, "用户停止了本轮生成"],
    [TURN_TERMINAL_COMMAND.ERROR]: [TURN_STATUS.ERROR, TURN_STATUS_REASON.RUN_ERROR, "本轮对话异常停止"],
    [TURN_TERMINAL_COMMAND.ABORTED]: [TURN_STATUS.ERROR, TURN_STATUS_REASON.RUN_ABORTED, "本轮对话已中止"],
    [TURN_TERMINAL_COMMAND.TIMEOUT]: [TURN_STATUS.TIMEOUT, TURN_STATUS_REASON.RUN_TIMEOUT, "本轮对话运行超时"],
  }[normalizedCommand];
  if (!contract) return null;
  const [status, reason, defaultDescription] = contract;
  return normalizeTurnStatusEntity({
    ...payload,
    status,
    reason,
    description: text(payload?.description) || defaultDescription,
    error: plainError(payload?.error),
  });
}

export function normalizeTurnStatusEntity(status = {}, now = () => new Date().toISOString()) {
  if (!status || typeof status !== "object" || Array.isArray(status)) return null;
  const turnScopeId = text(status.turnScopeId);
  const dialogProcessId = resolveMessageDialogProcessId(status);
  if (!turnScopeId && !dialogProcessId) return null;
  const state = text(status.status).toLowerCase();
  if (!TERMINAL.has(state)) return null;
  const reason = text(status.reason).toLowerCase();
  if (!REASONS_BY_STATUS[state]?.has(reason)) return null;
  const normalized = {
    turnScopeId,
    dialogProcessId,
    status: state,
    reason,
    description: text(status.description),
    updatedAt: text(status.updatedAt) || now(),
  };
  const createdAt = text(status.createdAt);
  normalized.createdAt = createdAt || normalized.updatedAt;
  const parentDialogProcessId = text(status.parentDialogProcessId);
  if (parentDialogProcessId) normalized.parentDialogProcessId = parentDialogProcessId;
  const error = plainError(status.error);
  if (error) normalized.error = error;
  return Object.fromEntries(Object.entries(normalized).filter(([, v]) => v !== ""));
}

export function normalizeTurnStatusesEntity(statuses = [], now = () => new Date().toISOString()) {
  const source = Array.isArray(statuses) ? statuses : Object.values(statuses && typeof statuses === "object" ? statuses : {});
  const normalizedStatuses = [];
  for (const item of source) {
    const normalized = normalizeTurnStatusEntity(item, now);
    if (!normalized) continue;
    const index = normalizedStatuses.findIndex((existing) =>
      Boolean(
        (normalized.turnScopeId && existing.turnScopeId === normalized.turnScopeId) ||
        (normalized.dialogProcessId && existing.dialogProcessId === normalized.dialogProcessId)
      ));
    if (index < 0) normalizedStatuses.push(normalized);
    else normalizedStatuses[index] = {
      ...normalizedStatuses[index],
      ...normalized,
      createdAt: normalizedStatuses[index].createdAt || normalized.createdAt,
    };
  }
  return normalizedStatuses;
}

export function isSameTurnStatus(left = {}, right = {}) {
  const leftTurnScopeId = text(left?.turnScopeId);
  const rightTurnScopeId = text(right?.turnScopeId);
  const leftDialogProcessId = resolveMessageDialogProcessId(left);
  const rightDialogProcessId = resolveMessageDialogProcessId(right);
  return Boolean(
    (leftTurnScopeId && rightTurnScopeId && leftTurnScopeId === rightTurnScopeId) ||
    (leftDialogProcessId && rightDialogProcessId && leftDialogProcessId === rightDialogProcessId)
  );
}

/**
 * Apply one immutable terminal fact to a session aggregate.
 * The first persisted terminal outcome wins; same-status retries are idempotent
 * updates. Messages are used only to bridge the two canonical turn identities.
 */
export function upsertTurnStatusEntity({
  statuses = [],
  messages = [],
  incoming = {},
  now = () => new Date().toISOString(),
} = {}) {
  const initial = normalizeTurnStatusEntity(incoming, now);
  if (!initial) return { statuses: normalizeTurnStatusesEntity(statuses, now), turnStatus: null, changed: false };
  const identityMessage = (Array.isArray(messages) ? messages : [])
    .find((message) => isSameTurnStatus(initial, message));
  const normalized = normalizeTurnStatusEntity({
    ...initial,
    turnScopeId: initial.turnScopeId || text(identityMessage?.turnScopeId),
    dialogProcessId: initial.dialogProcessId || resolveMessageDialogProcessId(identityMessage),
  }, now);
  if (!normalized) return { statuses: normalizeTurnStatusesEntity(statuses, now), turnStatus: null, changed: false };

  const source = normalizeTurnStatusesEntity(statuses, now);
  const index = source.findIndex((item) => isSameTurnStatus(item, normalized));
  if (index < 0) return { statuses: [...source, normalized], turnStatus: normalized, changed: true };

  const existing = source[index];
  if (existing.status !== normalized.status) {
    return { statuses: source, turnStatus: existing, changed: false };
  }
  const persisted = { ...existing, ...normalized, createdAt: existing.createdAt || normalized.createdAt };
  const next = [...source];
  next[index] = persisted;
  return {
    statuses: next,
    turnStatus: persisted,
    changed: JSON.stringify(existing) !== JSON.stringify(persisted),
  };
}
