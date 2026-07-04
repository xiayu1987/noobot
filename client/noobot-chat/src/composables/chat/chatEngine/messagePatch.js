/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  mergeAssistantContents,
  normalizeTrimmedString,
  patchAssistantFromWorkflowMessage,
  pickAssistantMessagesForCurrentTurn,
} from "./utils";
import { getMessageDialogProcessId, getMessageTurnScopeId } from "../../infra/messageIdentity";

export function applyDoneMessagesPatch({
  data = {},
  botMessage = null,
  activeSession = null,
  makeViewMessage,
  foldMessagesForView,
  mergeAssistantAttachments,
} = {}) {
  if (!botMessage || !activeSession?.value || !Array.isArray(data?.messages) || !data.messages.length) {
    return false;
  }
  const botTurnScopeId = getMessageTurnScopeId(botMessage);

  const rawMessagesForView = data.messages.map((messageItem) => makeViewMessage(messageItem));
  // DONE messages are a replay snapshot used to patch the current
  // pending/streaming overlay.  Do not publish them into session.rawMessages as
  // another completed-message array; the final display source is normalized
  // session detail, while this path only updates the in-flight bot message.
  const folded = foldMessagesForView(rawMessagesForView);
  const assistantMessagesForCurrentTurn = pickAssistantMessagesForCurrentTurn({
    foldedMessages: folded,
    dialogProcessId: getMessageDialogProcessId(botMessage) || data.dialogProcessId,
    turnScopeId: botTurnScopeId,
  });
  const workflowAssistants = assistantMessagesForCurrentTurn.filter(
    (messageItem) => messageItem?.workflowMessage === true,
  );
  const normalAssistants = assistantMessagesForCurrentTurn.filter(
    (messageItem) => messageItem?.workflowMessage !== true,
  );
  const patchAssistants = normalAssistants.filter(
    (messageItem) => String(messageItem?.type || "") !== "tool_call",
  );
  if (patchAssistants.length) {
    const lastAssistant = patchAssistants[patchAssistants.length - 1];
    const lastAssistantTurnScopeId = getMessageTurnScopeId(lastAssistant);
    if (botTurnScopeId && lastAssistantTurnScopeId && lastAssistantTurnScopeId !== botTurnScopeId) {
      return true;
    }
    const mergedAssistantContent = mergeAssistantContents(patchAssistants);
    const lastAssistantType = String(lastAssistant.type || "");
    if (lastAssistantType && lastAssistantType !== "tool_call") {
      botMessage.type = lastAssistantType;
    }
    botMessage.tool_calls = Array.isArray(lastAssistant.tool_calls)
      ? lastAssistant.tool_calls
      : [];
    botMessage.dialogProcessId = getMessageDialogProcessId(lastAssistant) || getMessageDialogProcessId(botMessage);
    botMessage.content = String(mergedAssistantContent || botMessage.content || "");
    botMessage.modelAlias = normalizeTrimmedString(lastAssistant.modelAlias);
    botMessage.modelName = normalizeTrimmedString(lastAssistant.modelName);
    if (Array.isArray(lastAssistant.modelRuns)) {
      botMessage.modelRuns = lastAssistant.modelRuns;
    }
    if (botTurnScopeId && lastAssistantTurnScopeId === botTurnScopeId) {
      mergeAssistantAttachments(botMessage, lastAssistant.attachments || []);
    }
  } else {
    const latestWorkflowAssistant = workflowAssistants[workflowAssistants.length - 1] || null;
    if (latestWorkflowAssistant) {
      patchAssistantFromWorkflowMessage(botMessage, makeViewMessage(latestWorkflowAssistant));
    }
  }
  return true;
}
