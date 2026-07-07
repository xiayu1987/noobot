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

export function isInFlightAssistantMessage(messageItem = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  const runtimeView = resolveSessionRunMessageRuntimeView(messageItem);
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

export function hasMatchingInFlightAssistantMessage(messages = [], { turnScopeId = "" } = {}) {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  return sourceMessages.some((messageItem) => (
    isInFlightAssistantMessage(messageItem) &&
    isMessageInRunScope(messageItem, { turnScopeId })
  ));
}

export function hasInFlightAssistantMissingFromDetail({
  currentMessages = [],
  detailMessages = [],
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
      isInFlightAssistantMessage(messageItem),
    );
  });
}
