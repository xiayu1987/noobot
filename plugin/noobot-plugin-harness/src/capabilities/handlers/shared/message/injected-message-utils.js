/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  HARNESS_INJECTED_MESSAGE_BY_FIELD,
  HARNESS_INJECTED_MESSAGE_BY_VALUE,
  HARNESS_INJECTED_MESSAGE_FLAG_FIELD,
  HARNESS_INJECTED_MESSAGE_FLAG_VALUE,
  HARNESS_INJECTION_MESSAGE_ROLE,
} from "../constants.js";
import { resolveDialogProcessIdFromContext } from "../runtime/dialog-process-id.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function buildHarnessInjectedMessage(
  content = "",
  {
    role = "",
    attachmentMetas = [],
    transferResult = null,
    transferEnvelope = null,
    transferEnvelopes = [],
    dialogProcessId = "",
  } = {},
) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const message = {
    role: normalizedRole || HARNESS_INJECTION_MESSAGE_ROLE,
    content: String(content || ""),
    [HARNESS_INJECTED_MESSAGE_FLAG_FIELD]: HARNESS_INJECTED_MESSAGE_FLAG_VALUE,
    [HARNESS_INJECTED_MESSAGE_BY_FIELD]: HARNESS_INJECTED_MESSAGE_BY_VALUE,
  };
  const normalizedDialogProcessId = resolveDialogProcessIdFromContext({
    dialogProcessId,
  });
  if (normalizedDialogProcessId) {
    message.dialogProcessId = normalizedDialogProcessId;
  }
  if (Array.isArray(attachmentMetas) && attachmentMetas.length) {
    message.attachmentMetas = attachmentMetas;
  }
  const normalizedTransferResult = isPlainObject(transferResult) ? transferResult : null;
  const normalizedTransferEnvelope = isPlainObject(transferEnvelope)
    ? transferEnvelope
    : isPlainObject(normalizedTransferResult?.envelope)
      ? normalizedTransferResult.envelope
      : null;
  const normalizedTransferEnvelopes = Array.isArray(transferEnvelopes)
    ? transferEnvelopes.filter(isPlainObject)
    : normalizedTransferEnvelope
      ? [normalizedTransferEnvelope]
      : [];
  if (normalizedTransferResult) {
    message.transferResult = normalizedTransferResult;
  }
  if (normalizedTransferEnvelope) {
    message.transferEnvelope = normalizedTransferEnvelope;
  }
  if (normalizedTransferEnvelopes.length) {
    message.transferEnvelopes = normalizedTransferEnvelopes;
  }
  return message;
}

export function resolveCurrentTurnMessagesStore(ctx = {}) {
  const runtime =
    ctx?.agentContext?.execution?.controllers?.runtime &&
    typeof ctx.agentContext.execution.controllers.runtime === "object"
      ? ctx.agentContext.execution.controllers.runtime
      : {};
  const store = runtime?.currentTurnMessages;
  return store && typeof store.push === "function" ? store : null;
}

export function persistHarnessMessageToCurrentTurn(
  ctx = {},
  message = {},
  enabled = false,
) {
  if (enabled !== true) return false;
  const currentTurnMessages = resolveCurrentTurnMessagesStore(ctx);
  if (!currentTurnMessages) return false;
  currentTurnMessages.push({
    ...message,
    type: "message",
    dialogProcessId: resolveDialogProcessIdFromContext(ctx),
  });
  return true;
}
