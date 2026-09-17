/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { HumanMessage } from "@langchain/core/messages";
import { appendContextMessage } from "@noobot/context-protocol/mutation/context";
import { createSessionMessageUid } from "../../context/session/message-uid.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";

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
    throw new TypeError("Turn context control message internalType is required");
  }
}

export function appendTurnContextControlMessage({
  runtime = null,
  loopState = null,
  content = "",
  internalType = "",
} = {}) {
  const turnMessageStore = runtime?.currentTurnMessages;
  const modelContext = loopState?.modelContext;
  const dialogProcessId = String(loopState?.dialogProcessId || "").trim();
  const turnScopeId = String(modelContext?.activeTurnIdentity?.turnScopeId || "").trim();
  const normalizedInternalType = String(internalType || "").trim();
  requireTurnContextStores({
    turnMessageStore,
    modelContext,
    dialogProcessId,
    turnScopeId,
    internalType: normalizedInternalType,
  });
  const messageUid = createSessionMessageUid();
  const additionalKwargs = {
    noobotMessageId: messageUid,
    noobotInternalMessageType: normalizedInternalType,
    chatPresentation: false,
  };
  const persistedMessage = turnMessageStore.push({
    messageUid,
    role: "user",
    type: "context_control",
    chatPresentation: false,
    noobotInternalMessageType: normalizedInternalType,
    content: String(content || ""),
    dialogProcessId,
    turnScopeId,
    additional_kwargs: additionalKwargs,
  });
  appendContextMessage(
    modelContext,
    new HumanMessage({
      content: persistedMessage.content,
      additional_kwargs: additionalKwargs,
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
  const modelContext = loopState?.modelContext || runtime?.activeMessageContext;
  const dialogProcessId = String(
    loopState?.dialogProcessId || modelContext?.activeTurnIdentity?.dialogProcessId || "",
  ).trim();
  const turnScopeId = String(modelContext?.activeTurnIdentity?.turnScopeId || "").trim();
  const messageUid = String(interjection?.messageUid || "").trim();
  const content = String(interjection?.message || "").trim();
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
    .find((message = {}) => String(message.messageUid || "").trim() === messageUid);
  if (existing) return existing;
  const additionalKwargs = {
    noobotMessageId: messageUid,
    noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    injectedMessage: true,
    injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
    chatPresentation: false,
  };
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
    dialogProcessId,
    turnScopeId,
    additional_kwargs: additionalKwargs,
  });
  const modelMessage = new HumanMessage({ content, additional_kwargs: additionalKwargs });
  modelMessage.messageUid = messageUid;
  modelMessage.dialogProcessId = dialogProcessId;
  modelMessage.turnScopeId = turnScopeId;
  modelMessage.injectedMessage = true;
  modelMessage.injectedMessageType = CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION;
  modelMessage.noobotInternalMessageType = CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION;
  appendContextMessage(modelContext, modelMessage, { block: "incremental" });
  return persistedMessage;
}
