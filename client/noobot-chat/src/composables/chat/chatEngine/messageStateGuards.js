/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import {
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { normalizeTrimmedString } from "./utils";
import { MESSAGE_IN_FLIGHT_CHANNEL_STATES } from "../sessionRunStateMachine/constants";

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
  if (!getMessageTurnScopeId(messageItem)) return false;
  if (messageItem?.pending === true) return true;
  const channelState = normalizeTrimmedString(messageItem?.channelState?.state);
  return MESSAGE_IN_FLIGHT_CHANNEL_STATES.includes(channelState);
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
