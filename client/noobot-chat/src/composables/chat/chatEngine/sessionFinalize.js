/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { normalizeTrimmedString } from "./utils";
import { getMessageDialogProcessId, getMessageRole } from "../../infra/messageIdentity";
import { getMessageAttachments } from "../../infra/messageModel";
import { SESSION_RUN_EVENT, FrontendRunState } from "../sessionRunStateMachine";
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
  applyAssistantFailureState,
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
    const detailSessionId = normalizeTrimmedString(
      detail?.sessionId || detail?.backendSessionId || detail?.id,
    );
    const explicitlyScopedDocs = sessionDocs.filter((doc) => normalizeTrimmedString(doc?.sessionId));
    const matchingSessionDoc = sessionDocs.find((doc) =>
      normalizeTrimmedString(doc?.sessionId || doc?.backendSessionId || doc?.id) === doneSessionId,
    );
    if (
      !detail ||
      (sessionDocs.length === 0 && !detailSessionId) ||
      (detailSessionId && detailSessionId !== doneSessionId) ||
      (explicitlyScopedDocs.length > 0 && !matchingSessionDoc)
    ) {
      throw new Error("final session summary identity mismatch or empty");
    }
    const mainSessionDoc = matchingSessionDoc || sessionDocs[0];
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
    // The detail request is asynchronous.  A resend, session switch, or a
    // replacement assistant message may have made this completion obsolete;
    // stale failures must never overwrite the currently active run.
    const currentMessages = Array.isArray(activeSession?.value?.messages)
      ? activeSession.value.messages
      : [];
    const currentMessage = currentMessages.includes(botMessage)
      ? botMessage
      : currentMessages.find((messageItem) =>
          messageItem &&
          getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
          normalizeTrimmedString(getMessageDialogProcessId(messageItem)) === completionEventScope.dialogProcessId &&
          normalizeTrimmedString(messageItem.turnScopeId) === completionEventScope.turnScopeId,
        );
    const activeSessionMatches =
      String(activeSession?.value?.backendSessionId || "") === completionEventScope.sessionId &&
      String(activeSession?.value?.id || "") === String(activeSessionId?.value || "");
    const isCurrentCompletion = activeSessionMatches && (
      // Authoritative reconnect snapshots can complete a run before its
      // assistant message has been hydrated. In that case the state-machine
      // identity guards, rather than a missing message object, decide whether
      // the scoped failure still belongs to the current run.
      !botMessage ||
      (
        currentMessage === botMessage &&
        normalizeTrimmedString(getMessageDialogProcessId(botMessage)) === completionEventScope.dialogProcessId &&
        normalizeTrimmedString(botMessage?.turnScopeId) === completionEventScope.turnScopeId
      )
    );
    if (!isCurrentCompletion) {
      logStateMachineDebug("stateMachine.detailRequest.failed.ignored_stale", {
        ...completionEventScope,
        activeSessionId: activeSessionId?.value || "",
        botMessage: summarizeFinalizeMessage(botMessage),
      });
      return false;
    }
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
      ...completionEventScope,
      source: "final_session_detail",
    });
    // The backend turn is already terminal at this point.  Do not leave the
    // local assistant message pending while the authoritative detail request
    // failure is represented by the frontend state machine.
    if (botMessage) {
      applyAssistantFailureState?.(botMessage, loadDetailError);
      botMessage.channelState = {
        ...(botMessage.channelState && typeof botMessage.channelState === "object"
          ? botMessage.channelState
          : {}),
        state: FrontendRunState.COMPLETION_ERROR,
        sessionId: completionEventScope.sessionId,
        dialogProcessId: completionEventScope.dialogProcessId,
        turnScopeId: completionEventScope.turnScopeId,
        sourceEvent: "final_session_detail",
      };
    }
    return false;
  }
}

export async function finalizeDoneSessionDetail(options = {}) {
  return refreshFinalSessionDetail(options);
}

/**
 * Read-after-write convergence for a persisted user stop.  USER_STOPPED is a
 * backend terminal fact, not the frontend terminal: only applying this summary
 * may move USER_STOPPING to USER_STOP_COMPLETED.
 */
export async function finalizeStoppedSessionDetail({
  activeSession,
  activeSessionId,
  botMessage,
  finalEventData,
  fetchSessionDetail,
  applySessionDetail,
  applyRunStateEvent,
} = {}) {
  const sessionId = resolveFinalizeSessionId({ activeSession, finalEventData });
  const scope = {
    sessionId,
    dialogProcessId: normalizeTrimmedString(
      finalEventData?.dialogProcessId || getMessageDialogProcessId(botMessage),
    ),
    turnScopeId: normalizeTrimmedString(finalEventData?.turnScopeId || botMessage?.turnScopeId),
  };
  if (!sessionId) {
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_FAILED,
      ...scope,
      source: "stopped_session_detail",
    });
    return false;
  }
  try {
    const detail = await fetchSessionDetail(sessionId, {
      source: "userStoppedFinalStatus",
      force: true,
      reuseRecentlyLoaded: false,
    });
    if (!detail) throw new Error("stopped session summary is empty");
    // Keep the live turn placeholder and converge it with the authoritative
    // turnStatus from the summary. Replacing the whole message array here used
    // to discard the reactive placeholder and inject a second synthetic one,
    // which broke its position, status-step updates, and last-message actions.
    applySessionDetail(detail, { preserveCurrentMessages: true, scrollToBottom: false });
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
      ...scope,
      source: "stopped_session_detail",
    });
    return true;
  } catch (error) {
    applyRunStateEvent?.({
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_FAILED,
      ...scope,
      source: "stopped_session_detail",
      error,
    });
    return false;
  }
}
