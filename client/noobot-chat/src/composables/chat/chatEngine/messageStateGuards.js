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
import { selectTurnMessageRuntime } from "../sessionRunStateMachine/turnRuntimeRegistry";

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

export function isInFlightAssistantMessage(messageItem = {}, {
  registry = null,
  sessionId = "",
} = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  const turnScopeId = getMessageTurnScopeId(messageItem);
  const dialogProcessId = getMessageDialogProcessId(messageItem);
  const registryView = selectTurnMessageRuntime(registry, { sessionId, turnScopeId, dialogProcessId });
  // Registry is the runtime source of truth. Message runtime projection is only
  // a bootstrap fallback while the registry has not observed this Turn yet;
  // legacy turnStatuses never participate in this decision.
  const runtimeView = registryView?.source
    ? { ...registryView, inFlightAssistant: registryView.running === true }
    : resolveSessionRunMessageRuntimeView(messageItem);
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

export function hasMatchingInFlightAssistantMessage(messages = [], {
  turnScopeId = "", registry = null, sessionId = "",
} = {}) {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  return sourceMessages.some((messageItem) => (
    isInFlightAssistantMessage(messageItem, { registry, sessionId }) &&
    isMessageInRunScope(messageItem, { turnScopeId })
  ));
}

export function hasInFlightAssistantMissingFromDetail({
  currentMessages = [],
  detailMessages = [],
  registry = null,
  sessionId = "",
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
      isInFlightAssistantMessage(messageItem, { registry, sessionId }),
    );
  });
}
