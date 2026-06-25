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
  HARNESS_INJECTED_MESSAGE_TYPE_FIELD,
  HARNESS_INJECTION_MESSAGE_ROLE,
  HARNESS_PROMPT_INJECTION_ID_FIELD,
  HARNESS_MESSAGE_BLOCK_POLICY_FIELD,
  HARNESS_MESSAGE_BLOCK_POLICY_PRESERVE_FIELD,
  HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_FIELD,
  HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_SYSTEM,
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
    legacyAttachmentMetasMirror = false,
    transferEnvelopes = [],
    dialogProcessId = "",
    injectedMessageType = "",
    injectionType = "",
    promptInjectionId = "",
    messageBlockPolicy = null,
    preserveSystemMessage = false,
  } = {},
) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const message = {
    role: normalizedRole || HARNESS_INJECTION_MESSAGE_ROLE,
    content: String(content || ""),
    [HARNESS_INJECTED_MESSAGE_FLAG_FIELD]: HARNESS_INJECTED_MESSAGE_FLAG_VALUE,
    [HARNESS_INJECTED_MESSAGE_BY_FIELD]: HARNESS_INJECTED_MESSAGE_BY_VALUE,
  };
  const normalizedInjectedMessageType = String(
    injectedMessageType || injectionType || "",
  ).trim();
  if (normalizedInjectedMessageType) {
    message[HARNESS_INJECTED_MESSAGE_TYPE_FIELD] = normalizedInjectedMessageType;
  }
  const normalizedPromptInjectionId = String(promptInjectionId || "").trim();
  if (normalizedPromptInjectionId) {
    message[HARNESS_PROMPT_INJECTION_ID_FIELD] = normalizedPromptInjectionId;
  }
  const normalizedMessageBlockPolicy = isPlainObject(messageBlockPolicy)
    ? { ...messageBlockPolicy }
    : {};
  if (preserveSystemMessage === true) {
    normalizedMessageBlockPolicy[HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_FIELD] =
      normalizedMessageBlockPolicy[HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_FIELD] ||
      HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_SYSTEM;
    normalizedMessageBlockPolicy[HARNESS_MESSAGE_BLOCK_POLICY_PRESERVE_FIELD] = true;
  }
  if (Object.keys(normalizedMessageBlockPolicy).length) {
    message[HARNESS_MESSAGE_BLOCK_POLICY_FIELD] = normalizedMessageBlockPolicy;
  }
  const normalizedDialogProcessId = resolveDialogProcessIdFromContext({
    dialogProcessId,
  });
  if (normalizedDialogProcessId) {
    message.dialogProcessId = normalizedDialogProcessId;
  }
  if (
    legacyAttachmentMetasMirror === true &&
    Array.isArray(attachmentMetas) &&
    attachmentMetas.length
  ) {
    message.attachmentMetas = attachmentMetas;
  }
  const normalizedTransferEnvelopes = Array.isArray(transferEnvelopes)
    ? transferEnvelopes.filter(isPlainObject)
    : [];
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
