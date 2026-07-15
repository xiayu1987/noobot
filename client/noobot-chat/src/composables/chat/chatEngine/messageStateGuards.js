/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { normalizeTrimmedString } from "./utils";
import { resolveSessionRunMessageRuntimeView } from "../sessionRunStateMachine";

export const SESSION_DETAIL_APPLY_MODE = Object.freeze({
  AUTO: "auto",
  MERGE_PRESERVE_IN_FLIGHT: "merge-preserve-inflight",
  DELETE_CONFIRMED: "delete-confirmed",
  FINALIZE_RUN: "finalize-run",
  REPLACE: "replace",
});

export function normalizeSessionDetailApplyMode(value = "") {
  const normalized = normalizeTrimmedString(value);
  return Object.values(SESSION_DETAIL_APPLY_MODE).includes(normalized)
    ? normalized
    : SESSION_DETAIL_APPLY_MODE.AUTO;
}

export function findMessageTurnStatus(messageItem = {}, turnStatuses = []) {
  const turnScopeId = getMessageTurnScopeId(messageItem);
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  return (Array.isArray(turnStatuses) ? turnStatuses : []).find((turnStatus) => {
    if (!turnStatus || typeof turnStatus !== "object" || Array.isArray(turnStatus)) return false;
    const statusTurnScopeId = normalizeTrimmedString(turnStatus.turnScopeId);
    const statusDialogProcessId = normalizeTrimmedString(
      turnStatus.dialogProcessId || getMessageDialogProcessId(turnStatus),
    );
    if (turnScopeId && statusTurnScopeId) return turnScopeId === statusTurnScopeId;
    return Boolean(dialogProcessId && statusDialogProcessId && dialogProcessId === statusDialogProcessId);
  }) || null;
}

export function isInFlightAssistantMessage(messageItem = {}, { turnStatuses = [] } = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  const runtimeView = resolveSessionRunMessageRuntimeView(
    messageItem,
    null,
    findMessageTurnStatus(messageItem, turnStatuses),
  );
  if (!runtimeView.inFlightAssistant) return false;
  const runtimeChannelState = runtimeView.channelState || {};
  const hasRuntimeIdentity = Boolean(
    getMessageTurnScopeId(messageItem) ||
    getMessageDialogProcessId(messageItem) ||
    runtimeChannelState.turnScopeId ||
    runtimeChannelState.dialogProcessId,
  );
  return hasRuntimeIdentity;
}

export function isMessageInRunScope(messageItem = {}, { turnScopeId = "" } = {}) {
  const normalizedTurnScopeId = normalizeTrimmedString(turnScopeId);
  if (!normalizedTurnScopeId) return true;
  return getMessageTurnScopeId(messageItem) === normalizedTurnScopeId;
}

export function hasMatchingInFlightAssistantMessage(messages = [], { turnScopeId = "", turnStatuses = [] } = {}) {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  return sourceMessages.some((messageItem) => (
    isInFlightAssistantMessage(messageItem, { turnStatuses }) &&
    isMessageInRunScope(messageItem, { turnScopeId })
  ));
}

export function hasInFlightAssistantMissingFromDetail({
  currentMessages = [],
  detailMessages = [],
  turnStatuses = [],
} = {}) {
  const detailTurnScopeIds = new Set(
    (Array.isArray(detailMessages) ? detailMessages : [])
      .map((messageItem) => getMessageTurnScopeId(messageItem))
      .filter(Boolean),
  );
  return (Array.isArray(currentMessages) ? currentMessages : []).some((messageItem) => {
    const turnScopeId = getMessageTurnScopeId(messageItem);
    return Boolean(
      turnScopeId &&
      !detailTurnScopeIds.has(turnScopeId) &&
      isInFlightAssistantMessage(messageItem, { turnStatuses }),
    );
  });
}
