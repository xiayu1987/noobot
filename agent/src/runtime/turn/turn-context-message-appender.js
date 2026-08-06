/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { HumanMessage } from "@langchain/core/messages";
import { appendContextMessage } from "@noobot/context-protocol/context-mutation";
import { createSessionMessageUid } from "../../context/session/message-uid.js";

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
  if (!turnMessageStore?.push || !modelContext || !dialogProcessId || !turnScopeId) {
    throw new Error("Turn context control message requires canonical Turn identity and message stores");
  }
  if (!normalizedInternalType) {
    throw new TypeError("Turn context control message internalType is required");
  }
  const messageUid = createSessionMessageUid();
  const additionalKwargs = {
    noobotMessageId: messageUid,
    noobotInternalMessageType: normalizedInternalType,
  };
  const persistedMessage = turnMessageStore.push({
    messageUid,
    role: "user",
    type: "context_control",
    noobotInternalMessageType: normalizedInternalType,
    content: String(content || ""),
    dialogProcessId,
    turnScopeId,
    additional_kwargs: additionalKwargs,
  });
  appendContextMessage(modelContext, new HumanMessage({
    content: persistedMessage.content,
    additional_kwargs: additionalKwargs,
  }), { block: "incremental" });
  return persistedMessage;
}
