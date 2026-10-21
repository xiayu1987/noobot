/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_INJECTED_MESSAGE_BY_VALUE, HARNESS_INJECTION_MESSAGE_ROLE } from "../constants.js";
import { createMessageUid } from "@noobot/context-protocol/message/message-identity";
import { resolveContextInjectedMessageType } from "@noobot/context-protocol/message/codec";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { isPlainObject, text } from "@noobot/shared/value";

const HARNESS_PROMPT_INJECTED_TYPE_PREFIX = "harness_prompt:";

export function harnessPromptInjectedMessageType(promptId = "") {
  const id = text(promptId);
  if (!id) throw new TypeError("harness prompt injection requires an id");
  return `${HARNESS_PROMPT_INJECTED_TYPE_PREFIX}${id}`;
}

export function isHarnessPromptMessage(message = {}, promptId = "") {
  return resolveContextInjectedMessageType(message) === harnessPromptInjectedMessageType(promptId);
}

export function isAnyHarnessPromptMessage(message = {}) {
  return resolveContextInjectedMessageType(message).startsWith(HARNESS_PROMPT_INJECTED_TYPE_PREFIX);
}

export function buildHarnessInjectedRecord(
  content = "",
  {
    role = "",
    attachments = [],
    transferEnvelopes = [],
    dialogProcessId = "",
    injectedMessageType = "",
    relayCorrelationId = "",
  } = {},
) {
  const normalizedInjectedMessageType = text(injectedMessageType);
  if (!normalizedInjectedMessageType) {
    throw new TypeError("harness injected message requires injectedMessageType");
  }
  const record = {
    type: "message",
    messageUid: createMessageUid(),
    role: text(role).toLowerCase() || HARNESS_INJECTION_MESSAGE_ROLE,
    content: String(content || ""),
    injectedMessage: true,
    injectedBy: HARNESS_INJECTED_MESSAGE_BY_VALUE,
    injectedMessageType: normalizedInjectedMessageType,
  };
  const normalizedDialogProcessId = text(dialogProcessId);
  if (normalizedDialogProcessId) record.dialogProcessId = normalizedDialogProcessId;
  const normalizedRelayCorrelationId = text(relayCorrelationId);
  if (normalizedRelayCorrelationId) record.relayCorrelationId = normalizedRelayCorrelationId;
  if (Array.isArray(attachments) && attachments.length) record.attachments = attachments;
  const envelopes = Array.isArray(transferEnvelopes) ? transferEnvelopes.filter(isPlainObject) : [];
  if (envelopes.length) record.transferEnvelopes = envelopes;
  return record;
}

export function buildHarnessInjectedMessage(content = "", options = {}) {
  return projectSessionRecordToContextMessage(buildHarnessInjectedRecord(content, options));
}

export function resolveCurrentTurnMessagesStore(ctx = {}) {
  const runtime =
    ctx?.agentContext?.bindings?.runtime && typeof ctx.agentContext.bindings.runtime === "object"
      ? ctx.agentContext.bindings.runtime
      : {};
  const store = runtime?.currentTurnMessages;
  return store && typeof store.push === "function" ? store : null;
}

export function persistHarnessRecordToCurrentTurn(ctx = {}, record = {}, enabled = false) {
  if (enabled !== true) return false;
  const currentTurnMessages = resolveCurrentTurnMessagesStore(ctx);
  if (!currentTurnMessages) return false;
  currentTurnMessages.push({ ...record });
  return true;
}
