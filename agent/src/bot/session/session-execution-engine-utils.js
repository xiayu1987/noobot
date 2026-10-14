/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { getTransferAttachments } from "../../transfer-adapter/storage/consumer.js";
import {
  isInjectedMessage,
  readMessageField,
  resolveInjectedMessageType,
} from "@noobot/context-protocol";
import { isPlainObject } from "@noobot/shared/value";

export function resolveTransferEnvelopesFromMessage(message = {}) {
  return resolveTransferEnvelopeListFromMessage(message);
}

export function resolveTransferEnvelopeListFromMessage(message = {}) {
  const transferEnvelopes = [
    ...(Array.isArray(message?.transferEnvelopes) ? message.transferEnvelopes : []),
    ...(Array.isArray(message?.lc_kwargs?.transferEnvelopes)
      ? message.lc_kwargs.transferEnvelopes
      : []),
  ].filter(isPlainObject);
  return transferEnvelopes;
}

export function resolvePreferredAttachments(message = {}) {
  const transferAttachments = getTransferAttachments(resolveTransferEnvelopesFromMessage(message));
  if (transferAttachments.length) return transferAttachments;
  if (Array.isArray(message?.attachments)) return message.attachments;
  if (Array.isArray(message?.lc_kwargs?.attachments)) return message.lc_kwargs.attachments;
  return [];
}

export function normalizeTrimmedStringList(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function applyNormalizedMessageFlags(normalized = {}, messageItem = {}) {
  if (isInjectedMessage(messageItem)) {
    normalized.injectedMessage = true;
  }
  const injectedBy = readMessageField(messageItem, "injectedBy");
  if (injectedBy) normalized.injectedBy = injectedBy;
  const injectedMessageType = resolveInjectedMessageType(messageItem);
  if (injectedMessageType) normalized.injectedMessageType = injectedMessageType;
  if (readMessageField(messageItem, "messageOrigin").toLowerCase() === "natural") {
    normalized.messageOrigin = "natural";
    normalized.userMetaMaterialized =
      messageItem?.userMetaMaterialized === true ||
      readMessageField(messageItem, "userMetaMaterialized").toLowerCase() === "true";
  }
  return normalized;
}

export function selectHookManager({ runConfig = {}, managerKey = "", createManager = null } = {}) {
  if (runConfig?.[managerKey] && typeof runConfig[managerKey] === "object") {
    return runConfig[managerKey];
  }
  return typeof createManager === "function" ? createManager() : null;
}
