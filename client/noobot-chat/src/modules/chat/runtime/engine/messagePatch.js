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
} from "./utils.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import { RoleEnum } from "../../model/chatConstants.js";

function insertTurnAssistant(activeMessages = [], targetMessage = {}, turnScopeId = "") {
  let lastTurnMessageIndex = -1;
  for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
    if (getMessageTurnScopeId(activeMessages[index]) === turnScopeId) {
      lastTurnMessageIndex = index;
      break;
    }
  }
  activeMessages.splice(lastTurnMessageIndex + 1, 0, targetMessage);
}

function isWorkflowAssistantSnapshot(messageItem = {}) {
  const pluginSource = normalizeTrimmedString(messageItem?.pluginMeta?.source);
  const pluginKind = normalizeTrimmedString(messageItem?.pluginMeta?.kind);
  return Boolean(
    messageItem?.workflowMessage === true ||
    messageItem?.pluginMessage === true ||
    normalizeTrimmedString(messageItem?.type) === "workflow" ||
    pluginSource === "workflow-plugin" ||
    pluginKind === "workflow"
  );
}

export function reconcileDoneTurnSnapshot({
  data = {},
  targetAssistant = null,
  activeSession = null,
  makeViewMessage,
  foldMessagesForView,
  mergeAssistantAttachments = () => {},
  allowInsertAssistant = true,
} = {}) {
  if (!activeSession?.value || !Array.isArray(data?.messages) || !data.messages.length) {
    return { accepted: false, applied: false, inserted: false, reason: "done_messages_missing" };
  }
  const activeMessages = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  const doneTurnScopeId = normalizeTrimmedString(
    data?.turnScopeId || getMessageTurnScopeId(targetAssistant),
  );
  const doneDialogProcessId = normalizeTrimmedString(
    data?.dialogProcessId || getMessageDialogProcessId(targetAssistant),
  );
  const rawMessagesForView = data.messages.map((messageItem) => {
    const viewMessage = makeViewMessage(messageItem);
    if (
      doneTurnScopeId &&
      getMessageRole(viewMessage) === RoleEnum.ASSISTANT &&
      !getMessageTurnScopeId(viewMessage) &&
      getMessageDialogProcessId(viewMessage) === doneDialogProcessId
    ) {
      viewMessage.turnScopeId = doneTurnScopeId;
    }
    return viewMessage;
  });
  const folded = foldMessagesForView(rawMessagesForView);
  const assistantMessagesForCurrentTurn = pickAssistantMessagesForCurrentTurn({
    foldedMessages: folded,
    dialogProcessId: doneDialogProcessId,
    turnScopeId: doneTurnScopeId,
  });
  const workflowAssistants = assistantMessagesForCurrentTurn.filter(
    (messageItem) => isWorkflowAssistantSnapshot(messageItem),
  );
  const normalAssistants = assistantMessagesForCurrentTurn.filter(
    (messageItem) => !isWorkflowAssistantSnapshot(messageItem),
  );
  const patchAssistants = normalAssistants.filter(
    (messageItem) => String(messageItem?.type || "") !== "tool_call",
  );
  const latestWorkflowAssistant = workflowAssistants[workflowAssistants.length - 1] || null;
  const latestNormalAssistant = patchAssistants[patchAssistants.length - 1] || null;
  const snapshotAssistant = latestNormalAssistant || latestWorkflowAssistant;
  if (!snapshotAssistant) {
    return { accepted: true, applied: false, inserted: false, reason: "done_assistant_missing" };
  }

  let resolvedTarget = targetAssistant || activeMessages.find((messageItem) =>
    getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
    doneTurnScopeId &&
    getMessageTurnScopeId(messageItem) === doneTurnScopeId,
  );
  let inserted = false;
  if (!resolvedTarget && allowInsertAssistant && doneTurnScopeId) {
    resolvedTarget = {
      role: RoleEnum.ASSISTANT,
      sessionId: normalizeTrimmedString(data?.sessionId || snapshotAssistant?.sessionId),
      dialogProcessId: doneDialogProcessId,
      turnScopeId: doneTurnScopeId,
      content: "",
      attachments: [],
      toolTimeline: [],
      activityTimeline: [],
    };
    insertTurnAssistant(activeMessages, resolvedTarget, doneTurnScopeId);
    inserted = true;
  }
  if (!resolvedTarget) {
    return { accepted: true, applied: false, inserted: false, reason: "target_assistant_missing" };
  }

  if (latestNormalAssistant) {
    const latestAssistantTurnScopeId = getMessageTurnScopeId(latestNormalAssistant);
    const targetTurnScopeId = getMessageTurnScopeId(resolvedTarget);
    if (targetTurnScopeId && latestAssistantTurnScopeId && latestAssistantTurnScopeId !== targetTurnScopeId) {
      return {
        accepted: true,
        applied: false,
        inserted,
        reason: "assistant_turn_mismatch",
        targetAssistant: resolvedTarget,
      };
    }
    const mergedAssistantContent = mergeAssistantContents(patchAssistants);
    const latestAssistantType = String(latestNormalAssistant.type || "");
    if (latestAssistantType && latestAssistantType !== "tool_call") {
      resolvedTarget.type = latestAssistantType;
    }
    resolvedTarget.tool_calls = Array.isArray(latestNormalAssistant.tool_calls)
      ? latestNormalAssistant.tool_calls
      : [];
    resolvedTarget.dialogProcessId = getMessageDialogProcessId(latestNormalAssistant) ||
      getMessageDialogProcessId(resolvedTarget) || doneDialogProcessId;
    if (doneTurnScopeId) resolvedTarget.turnScopeId = doneTurnScopeId;
    resolvedTarget.content = String(mergedAssistantContent || resolvedTarget.content || "");
    resolvedTarget.modelAlias = normalizeTrimmedString(latestNormalAssistant.modelAlias);
    resolvedTarget.modelName = normalizeTrimmedString(latestNormalAssistant.modelName);
    if (Array.isArray(latestNormalAssistant.modelRuns)) {
      resolvedTarget.modelRuns = latestNormalAssistant.modelRuns;
    }
    if (doneTurnScopeId && latestAssistantTurnScopeId === doneTurnScopeId) {
      mergeAssistantAttachments(resolvedTarget, latestNormalAssistant.attachments || []);
    }
  } else {
    patchAssistantFromWorkflowMessage(resolvedTarget, makeViewMessage(latestWorkflowAssistant));
  }
  return {
    accepted: true,
    applied: true,
    inserted,
    reason: "",
    targetAssistant: resolvedTarget,
  };
}

export function applyDoneMessagesPatch({
  data = {},
  botMessage = null,
  activeSession = null,
  makeViewMessage,
  foldMessagesForView,
  mergeAssistantAttachments,
} = {}) {
  if (!botMessage) return false;
  return reconcileDoneTurnSnapshot({
    data,
    targetAssistant: botMessage,
    activeSession,
    makeViewMessage,
    foldMessagesForView,
    mergeAssistantAttachments,
  }).accepted;
}
