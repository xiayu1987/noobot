/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { HumanMessage } from "@langchain/core/messages";
import { appendContextMessage } from "@noobot/context-protocol/mutation/context";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import {
  CONTEXT_CONTROL_MESSAGE_TYPES,
  CONTEXT_INJECTED_MESSAGE_TYPE,
} from "@noobot/context-protocol/policy/injected-message";
import { text } from "@noobot/shared/value";
import { requireActiveModelContext } from "../active-model-context.js";

function requireTurnContextStores({
  turnMessageStore,
  modelContext,
  dialogProcessId,
  turnScopeId,
  internalType,
}) {
  if (!turnMessageStore?.push || !modelContext || !dialogProcessId || !turnScopeId) {
    throw new Error(
      "Turn context control message requires canonical Turn identity and message stores",
    );
  }
  if (!internalType) {
    throw new TypeError("Turn context message internalType is required");
  }
}

export function appendTurnContextControlMessage({
  runtime = null,
  loopState = null,
  content = "",
  internalType = "",
} = {}) {
  const turnMessageStore = runtime?.currentTurnMessages;
  const modelContext = requireActiveModelContext(runtime);
  const dialogProcessId = text(loopState?.dialogProcessId);
  const turnScopeId = text(modelContext?.activeTurnIdentity?.turnScopeId);
  const normalizedInternalType = text(internalType);
  if (!CONTEXT_CONTROL_MESSAGE_TYPES.includes(normalizedInternalType)) {
    throw new TypeError(
      `Turn context control message internalType must be a context control type: ${normalizedInternalType}`,
    );
  }
  requireTurnContextStores({
    turnMessageStore,
    modelContext,
    dialogProcessId,
    turnScopeId,
    internalType: normalizedInternalType,
  });
  const messageUid = createMessageUid();
  const persistedMessage = turnMessageStore.push({
    messageUid,
    role: "user",
    type: "context_control",
    chatPresentation: false,
    injectedMessage: true,
    injectedMessageType: normalizedInternalType,
    noobotInternalMessageType: normalizedInternalType,
    content: String(content || ""),
    dialogProcessId,
    turnScopeId,
  });
  appendContextMessage(
    modelContext,
    writeContextMessageMetadata(new HumanMessage({ content: persistedMessage.content }), {
      messageUid,
      dialogProcessId,
      turnScopeId,
      noobotInternalMessageType: normalizedInternalType,
      injectedMessage: true,
      injectedMessageType: normalizedInternalType,
    }),
    { block: "incremental" },
  );
  return persistedMessage;
}

export function appendUserInterjectionMessage({
  runtime = null,
  loopState = null,
  interjection = {},
} = {}) {
  const turnMessageStore = runtime?.currentTurnMessages;
  const modelContext = requireActiveModelContext(runtime);
  const dialogProcessId = text(
    loopState?.dialogProcessId || modelContext?.activeTurnIdentity?.dialogProcessId,
  );
  const turnScopeId = text(modelContext?.activeTurnIdentity?.turnScopeId);
  const messageUid = text(interjection?.messageUid);
  const content = text(interjection?.message);
  const interjectionSequence = Number(interjection?.interjectionSequence || 0);
  requireTurnContextStores({
    turnMessageStore,
    modelContext,
    dialogProcessId,
    turnScopeId,
    internalType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
  });
  if (!messageUid || !content)
    throw new TypeError("User interjection identity and content are required");
  const existing = turnMessageStore
    .toArray()
    .find((message = {}) => text(message.messageUid) === messageUid);
  if (existing) return existing;
  const persistedMessage = turnMessageStore.push({
    messageUid,
    role: "user",
    type: "message",
    chatPresentation: false,
    injectedMessage: true,
    injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    content,
    ts: String(interjection?.receivedAt || new Date().toISOString()),
    interjectionSequence,
    dialogProcessId,
    turnScopeId,
  });
  const modelMessage = writeContextMessageMetadata(new HumanMessage({ content }), {
    messageUid,
    dialogProcessId,
    turnScopeId,
    noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    injectedMessage: true,
    injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
  });
  appendContextMessage(modelContext, modelMessage, { block: "incremental" });
  return persistedMessage;
}
