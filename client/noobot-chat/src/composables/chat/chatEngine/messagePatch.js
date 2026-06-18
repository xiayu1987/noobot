/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildWorkflowMessageSignature,
  mergeAssistantContents,
  normalizeTrimmedString,
  patchAssistantFromWorkflowMessage,
  pickAssistantMessagesForCurrentTurn,
} from "./utils";

function findCurrentTurnStartIndex(messages = []) {
  const messageList = Array.isArray(messages) ? messages : [];
  for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const messageItem = messageList[messageIndex] || {};
    if (String(messageItem?.role || "") !== "user") continue;
    if (messageItem?.injectedMessage === true) continue;
    return messageIndex;
  }
  for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
    if (String(messageList[messageIndex]?.role || "") === "user") return messageIndex;
  }
  return 0;
}

function stampCurrentTurnMessageRoundId(messages = [], messageRoundId = "") {
  const normalizedMessageRoundId = normalizeTrimmedString(messageRoundId);
  const messageList = Array.isArray(messages) ? messages : [];
  if (!normalizedMessageRoundId || !messageList.length) return messageList;
  const currentTurnStartIndex = findCurrentTurnStartIndex(messageList);
  for (let messageIndex = currentTurnStartIndex; messageIndex < messageList.length; messageIndex += 1) {
    const messageItem = messageList[messageIndex];
    if (!messageItem || typeof messageItem !== "object") continue;
    messageItem.messageRoundId = messageItem.messageRoundId || normalizedMessageRoundId;
  }
  return messageList;
}

export function applyDoneMessagesPatch({
  data = {},
  botMessage = null,
  activeSession = null,
  makeViewMessage,
  foldMessagesForView,
  mergeAssistantAttachmentMetas,
} = {}) {
  if (!botMessage || !activeSession?.value || !Array.isArray(data?.messages) || !data.messages.length) {
    return false;
  }

  const rawMessagesForView = stampCurrentTurnMessageRoundId(
    data.messages.map((messageItem) => makeViewMessage(messageItem)),
    botMessage.messageRoundId,
  );
  activeSession.value.rawMessages = rawMessagesForView;
  const folded = foldMessagesForView(rawMessagesForView);
  const assistantMessagesForCurrentTurn = pickAssistantMessagesForCurrentTurn({
    foldedMessages: folded,
    dialogProcessId: botMessage.dialogProcessId || data.dialogProcessId,
  });
  const workflowAssistants = assistantMessagesForCurrentTurn.filter(
    (messageItem) => messageItem?.workflowMessage === true,
  );
  const normalAssistants = assistantMessagesForCurrentTurn.filter(
    (messageItem) => messageItem?.workflowMessage !== true,
  );
  const latestWorkflowAssistant = workflowAssistants[workflowAssistants.length - 1] || null;
  const patchedWorkflowMessage = latestWorkflowAssistant
    ? patchAssistantFromWorkflowMessage(botMessage, makeViewMessage(latestWorkflowAssistant))
    : false;
  if (!patchedWorkflowMessage) {
    const patchAssistants = normalAssistants.length
      ? normalAssistants
      : assistantMessagesForCurrentTurn;
    const lastAssistant = patchAssistants[patchAssistants.length - 1];
    if (lastAssistant) {
      const mergedAssistantContent = mergeAssistantContents(patchAssistants);
      const lastAssistantType = String(lastAssistant.type || "");
      if (lastAssistantType && lastAssistantType !== "tool_call") {
        botMessage.type = lastAssistantType;
      }
      botMessage.tool_calls = Array.isArray(lastAssistant.tool_calls)
        ? lastAssistant.tool_calls
        : [];
      botMessage.dialogProcessId = lastAssistant.dialogProcessId || botMessage.dialogProcessId;
      botMessage.content = String(mergedAssistantContent || botMessage.content || "");
      botMessage.modelAlias = normalizeTrimmedString(lastAssistant.modelAlias);
      botMessage.modelName = normalizeTrimmedString(lastAssistant.modelName);
      if (Array.isArray(lastAssistant.modelRuns)) {
        botMessage.modelRuns = lastAssistant.modelRuns;
      }
      mergeAssistantAttachmentMetas(botMessage, lastAssistant.attachmentMetas || []);
    }
  }
  if (!patchedWorkflowMessage && workflowAssistants.length && Array.isArray(activeSession.value?.messages)) {
    const sessionMessages = activeSession.value.messages;
    const existingWorkflowSignatures = new Set(
      sessionMessages
        .filter((messageItem) => messageItem?.workflowMessage === true)
        .map((messageItem) => buildWorkflowMessageSignature(messageItem)),
    );
    let appendedCount = 0;
    for (const workflowMessageItem of workflowAssistants) {
      const signature = buildWorkflowMessageSignature(workflowMessageItem);
      if (!signature || existingWorkflowSignatures.has(signature)) continue;
      const viewWorkflowMessage = makeViewMessage(workflowMessageItem);
      viewWorkflowMessage.messageRoundId = viewWorkflowMessage.messageRoundId || botMessage.messageRoundId || "";
      viewWorkflowMessage.hasFirstStreamEvent = true;
      viewWorkflowMessage.pending = false;
      sessionMessages.push(viewWorkflowMessage);
      existingWorkflowSignatures.add(signature);
      appendedCount += 1;
    }
    if (appendedCount > 0) {
      activeSession.value.messageCount = sessionMessages.length;
      activeSession.value.lastMessage = sessionMessages[sessionMessages.length - 1] || null;
      activeSession.value.updatedAt = new Date().toISOString();
    }
  }

  return true;
}
