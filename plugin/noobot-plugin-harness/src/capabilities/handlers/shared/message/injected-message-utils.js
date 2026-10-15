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
import { createMessageUid } from "@noobot/context-protocol/message/identity";
import { readMessageField } from "@noobot/context-protocol/policy/message";
import { isPlainObject, text } from "@noobot/shared/value";

const HARNESS_PROMPT_INJECTED_TYPE_PREFIX = "harness_prompt:";

export function resolvePromptInjectionId(message = {}) {
  const direct = readMessageField(message, HARNESS_PROMPT_INJECTION_ID_FIELD);
  if (direct) return direct;
  const injectedMessageType = readMessageField(message, HARNESS_INJECTED_MESSAGE_TYPE_FIELD);
  return injectedMessageType.startsWith(HARNESS_PROMPT_INJECTED_TYPE_PREFIX)
    ? injectedMessageType.slice(HARNESS_PROMPT_INJECTED_TYPE_PREFIX.length).trim()
    : "";
}

export function buildHarnessInjectedMessage(
  content = "",
  {
    role = "",
    attachments = [],
    transferEnvelopes = [],
    dialogProcessId = "",
    injectedMessageType = "",
    injectionType = "",
    purpose = "",
    pluginFlow = "",
    chain = "",
    relayCorrelationId = "",
    promptInjectionId = "",
    messageBlockPolicy = null,
    preserveSystemMessage = false,
  } = {},
) {
  const normalizedRole = text(role).toLowerCase();
  const message = {
    messageUid: createMessageUid(),
    role: normalizedRole || HARNESS_INJECTION_MESSAGE_ROLE,
    content: String(content || ""),
    [HARNESS_INJECTED_MESSAGE_FLAG_FIELD]: HARNESS_INJECTED_MESSAGE_FLAG_VALUE,
    [HARNESS_INJECTED_MESSAGE_BY_FIELD]: HARNESS_INJECTED_MESSAGE_BY_VALUE,
  };
  const normalizedInjectedMessageType = text(injectedMessageType || injectionType);
  if (normalizedInjectedMessageType) {
    message[HARNESS_INJECTED_MESSAGE_TYPE_FIELD] = normalizedInjectedMessageType;
  }
  const normalizedPurpose = text(purpose);
  if (normalizedPurpose) {
    message.purpose = normalizedPurpose;
  }
  const normalizedPluginFlow = text(pluginFlow);
  if (normalizedPluginFlow) {
    message.pluginFlow = normalizedPluginFlow;
  }
  const normalizedChain = text(chain);
  if (normalizedChain) {
    message.chain = normalizedChain;
  }
  const normalizedRelayCorrelationId = text(relayCorrelationId);
  if (normalizedRelayCorrelationId) {
    message.relayCorrelationId = normalizedRelayCorrelationId;
  }
  const normalizedPromptInjectionId = text(promptInjectionId);
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
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  if (normalizedAttachments.length) {
    message.attachments = normalizedAttachments;
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
    ctx?.agentContext?.bindings?.runtime && typeof ctx.agentContext.bindings.runtime === "object"
      ? ctx.agentContext.bindings.runtime
      : {};
  const store = runtime?.currentTurnMessages;
  return store && typeof store.push === "function" ? store : null;
}

export function persistHarnessMessageToCurrentTurn(ctx = {}, message = {}, enabled = false) {
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
