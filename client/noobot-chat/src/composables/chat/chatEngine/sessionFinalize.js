/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { normalizeTrimmedString } from "./utils";
import { getMessageDialogProcessId, getMessageRole } from "../../infra/messageIdentity";
import { getMessageAttachments } from "../../infra/messageModel";
import { SESSION_RUN_EVENT } from "../sessionRunStateMachine";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../debug/stateMachineLogger";

function countCompletedToolLogAttachments(messageItem = {}) {
  return (Array.isArray(messageItem?.completedToolLogs) ? messageItem.completedToolLogs : [])
    .reduce((total, logItem) => total + (Array.isArray(logItem?.attachments) ? logItem.attachments.length : 0), 0);
}

function summarizeFinalizeMessage(messageItem = {}) {
  const summary = summarizeStateMachineMessage(messageItem);
  if (!summary) return summary;
  return {
    ...summary,
    attachmentsCount: getMessageAttachments(messageItem).length,
    completedToolLogAttachmentsCount: countCompletedToolLogAttachments(messageItem),
  };
}

function resolveFinalizeSessionId({
  activeSession,
  finalDoneEventData,
  finalEventData,
} = {}) {
  return String(
    finalEventData?.sessionId ||
      finalDoneEventData?.sessionId ||
      activeSession?.value?.backendSessionId ||
      "",
  );
}

export async function refreshFinalSessionDetail({
  activeSession,
  activeSessionId,
  botMessage,
  finalDoneEventData,
  finalEventData,
  fetchSessionDetail,
  applySessionDetail,
  applyRunStateEvent,
  refreshSessionConnectorsAsync,
  preserveCurrentMessages,
} = {}) {
  const doneSessionId = resolveFinalizeSessionId({
    activeSession,
    finalDoneEventData,
    finalEventData,
  });
  const finalExecutionLogTotal = Number(botMessage?.executionLogTotal || 0);
  const finalDialogProcessId = normalizeTrimmedString(
    getMessageDialogProcessId(botMessage) ||
      finalEventData?.dialogProcessId ||
      finalDoneEventData?.dialogProcessId,
  );

  if (!doneSessionId) {
    logStateMachineDebug("stateMachine.detailRequest.skip", {
      reason: "missing_done_session_id",
      activeSessionId: activeSessionId?.value || "",
      botMessage: summarizeFinalizeMessage(botMessage),
    });
    return false;
  }

  const completionEventScope = {
    sessionId: doneSessionId,
    dialogProcessId: finalDialogProcessId,
    turnScopeId: normalizeTrimmedString(botMessage?.turnScopeId || finalEventData?.turnScopeId || finalDoneEventData?.turnScopeId),
  };

  try {
    logStateMachineDebug("stateMachine.detailRequest.start", {
      ...completionEventScope,
      botMessage: summarizeFinalizeMessage(botMessage),
    });
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED,
      ...completionEventScope,
      source: "final_session_detail",
    });
    const detail = await fetchSessionDetail(doneSessionId);
    const sessionDocs = Array.isArray(detail?.sessions) ? detail.sessions : [];
    const mainSessionDoc = sessionDocs.find((doc) => doc?.sessionId === doneSessionId) || sessionDocs[0] || {};
    const detailMessages = Array.isArray(mainSessionDoc?.messages) ? mainSessionDoc.messages : [];
    logStateMachineDebug("detailApply.fetch.success", {
      ...completionEventScope,
      detailMessageCount: detailMessages.length,
      sessionDocsCount: sessionDocs.length,
    });
    const shouldPreserveCurrentMessages =
      typeof preserveCurrentMessages === "boolean"
        ? preserveCurrentMessages
        : String(doneSessionId || "") === String(activeSession?.value?.backendSessionId || "") &&
          String(activeSession?.value?.id || "") === String(activeSessionId?.value || "");

    logStateMachineDebug("detailApply.apply.start", {
      ...completionEventScope,
      preserveCurrentMessages: shouldPreserveCurrentMessages,
      detailMessageCount: detailMessages.length,
      botMessage: summarizeFinalizeMessage(botMessage),
    });
    applySessionDetail(detail, {
      preserveCurrentMessages: shouldPreserveCurrentMessages,
      scrollToBottom: false,
    });
    logStateMachineDebug("detailApply.apply.success", {
      ...completionEventScope,
      preserveCurrentMessages: shouldPreserveCurrentMessages,
      detailMessageCount: detailMessages.length,
      botMessage: summarizeFinalizeMessage(botMessage),
    });

    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      ...completionEventScope,
      source: "final_session_detail",
    });

    if (finalExecutionLogTotal > 0 && finalDialogProcessId) {
      const patchExecutionTotal = (messages = []) => {
        for (const messageItem of Array.isArray(messages) ? messages : []) {
          if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
          if (getMessageDialogProcessId(messageItem) !== finalDialogProcessId) {
            continue;
          }
          messageItem.executionLogTotal = Math.max(
            Number(messageItem?.executionLogTotal || 0),
            finalExecutionLogTotal,
          );
        }
      };
      patchExecutionTotal(activeSession?.value?.messages || []);
    }

    refreshSessionConnectorsAsync?.(activeSession?.value?.id || doneSessionId);
    return true;
  } catch (loadDetailError) {
    logStateMachineDebug("stateMachine.detailRequest.failed", {
      ...completionEventScope,
      error: String(loadDetailError?.message || loadDetailError || ""),
      botMessage: summarizeFinalizeMessage(botMessage),
    });
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
      ...completionEventScope,
      source: "final_session_detail",
    });
    console.warn("load session detail after done failed", loadDetailError);
    return false;
  }
}

export async function finalizeDoneSessionDetail(options = {}) {
  return refreshFinalSessionDetail(options);
}
