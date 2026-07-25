/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import {
  getMessageDialogProcessId,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../../infra/messageIdentity";
import { applyDoneMessagesPatch } from "./messagePatch";
import {
  normalizeExecutionLogForRealtime,
  normalizeTrimmedString,
  sanitizeExecutionLogForDisplay,
  stripInternalEventPlaceholderLines,
} from "./utils";
import {
  normalizeInteractionRequestPayload,
  resolveConnectorStatusPayload,
} from "../interactionPayload";
import { BackendChannelState } from "../sessionRunStateMachine";
import { mergeAttachments } from "../../infra/dialogProcessChain";
import { logThinkingReplayDebug } from "../debug/thinkingReplayDebugLogger";
import {
  logToolLogWindowDebug,
  summarizeToolLogWindow,
  summarizeToolLogWindowItem,
} from "../debug/toolLogWindowDebugLogger";
import { isToolActivityLog, reduceActivityTimeline } from "./activityTimeline";
import {
  buildToolTimelineFromLegacyLogs,
  fillMissingToolTimelineFacets,
  selectToolTimelineLogs,
  TOOL_SEQUENCE_DOMAIN,
  TOOL_TIMELINE_AUTHORITY,
} from "./toolTimeline";

function markFirstStreamEvent(botMessage) {
  if (!botMessage) return;
  botMessage.hasFirstStreamEvent = true;
}

function notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce }) {
  if (!getMessageDialogProcessId(botMessage)) return;
  locateSendingStartedMessageOnce?.();
}

function resolveFirstResponseNavigator({
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
} = {}) {
  if (typeof navigateOnFirstResponseOnce === "function") return navigateOnFirstResponseOnce;
  if (typeof scrollOnFirstResponseOnce === "function") return scrollOnFirstResponseOnce;
  return () => {};
}

export function handleThinkingStreamEvent({
  data,
  botMessage,
  classifyRealtimeLog,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
  locateSendingStartedMessageOnce,
}) {
  const scope = {
    sessionId: String(data?.sessionId || botMessage?.sessionId || ""),
    dialogProcessId: String(data?.dialogProcessId || getMessageDialogProcessId(botMessage) || ""),
    turnScopeId: String(data?.turnScopeId || getMessageTurnScopeId(botMessage) || ""),
  };
  const notifyFirstResponse = resolveFirstResponseNavigator({
    navigateOnFirstResponseOnce,
    scrollOnFirstResponseOnce,
  });
  const item = sanitizeExecutionLogForDisplay(classifyRealtimeLog(data));
  logToolLogWindowDebug("frontend.toolLogWindow.streamClassified", {
    ...scope,
    transportSequence: data?.sequence ?? data?.seq ?? null,
    raw: summarizeToolLogWindowItem(data),
    classified: item ? summarizeToolLogWindowItem(item) : null,
  });
  if (!item || !normalizeTrimmedString(item.text)) {
    const rawTextCandidates = {
      text: data?.text,
      output: data?.output,
      content: data?.content,
      message: data?.message,
      displayText: data?.displayText,
      nestedText: data?.data?.text,
      nestedOutput: data?.data?.output,
      nestedContent: data?.data?.content,
      nestedMessage: data?.data?.message,
      nestedDisplayText: data?.data?.displayText,
    };
    logThinkingReplayDebug("frontend.thinkingReplay.streamThinkingDropped", {
      ...scope,
      sequence: data?.sequence ?? data?.seq ?? null,
      reason: !item ? "classification-empty" : "text-empty",
      eventKeys: Object.keys(data || {}).sort(),
      nestedDataKeys: Object.keys(data?.data || {}).sort(),
      rawTextCandidates: Object.fromEntries(
        Object.entries(rawTextCandidates).map(([key, value]) => {
          const text = typeof value === "string"
            ? value
            : value == null
              ? ""
              : JSON.stringify(value);
          return [key, { length: text.length, preview: text.slice(0, 500) }];
        }),
      ),
    });
    return;
  }
  if (!item.subAgentCall && item.dialogProcessId) {
    botMessage.dialogProcessId = item.dialogProcessId;
  }
  notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
  markFirstStreamEvent(botMessage);
  const currentTimeline = Array.isArray(botMessage.toolTimeline) ? botMessage.toolTimeline : [];
  const projectedSequence = Number(data?.sequence ?? data?.seq) || currentTimeline.reduce(
    (maximum, entry) => Math.max(
      maximum,
      Number(entry?.call?.sequence || 0),
      Number(entry?.resultEvent?.sequence || 0),
    ),
    0,
  ) + 1;
  const projectionItem = {
    ...item,
    eventId: data?.eventId || item?.eventId || `legacy-stream:${scope.turnScopeId || scope.dialogProcessId}:${projectedSequence}`,
    sequence: projectedSequence,
    authority: TOOL_TIMELINE_AUTHORITY.COMPATIBILITY,
    sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT,
  };
  const toolProjection = buildToolTimelineFromLegacyLogs([projectionItem], {
    sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT,
  });
  if (toolProjection.length) {
    botMessage.toolTimeline = fillMissingToolTimelineFacets(botMessage.toolTimeline, toolProjection);
  } else {
    botMessage.activityTimeline = reduceActivityTimeline(botMessage.activityTimeline, {
      ...projectionItem,
    });
  }
  logToolLogWindowDebug("frontend.toolLogWindow.streamTimelineMerged", {
    ...scope,
    projectedSequence,
    projected: summarizeToolLogWindowItem(projectionItem),
    timelineEntryCount: botMessage.toolTimeline?.length || 0,
    timelineLogs: summarizeToolLogWindow(selectToolTimelineLogs(botMessage)),
  });
  logThinkingReplayDebug("frontend.thinkingReplay.streamThinkingAppended", {
    ...scope,
    dialogProcessId: String(item.dialogProcessId || scope.dialogProcessId),
    sequence: data?.sequence ?? data?.seq ?? null,
    toolTimelineCount: botMessage.toolTimeline?.length || 0,
    activityTimelineCount: botMessage.activityTimeline?.length || 0,
  });
  notifyFirstResponse();
}

export function handleDeltaStreamEvent({
  data,
  botMessage,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
  locateSendingStartedMessageOnce,
}) {
  const notifyFirstResponse = resolveFirstResponseNavigator({
    navigateOnFirstResponseOnce,
    scrollOnFirstResponseOnce,
  });
  const chunkText = stripInternalEventPlaceholderLines(data?.text || "");
  if (data?.dialogProcessId && !getMessageDialogProcessId(botMessage)) {
    botMessage.dialogProcessId = normalizeTrimmedString(data.dialogProcessId);
  }
  notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
  botMessage.content += chunkText;
  if (chunkText) {
    markFirstStreamEvent(botMessage);
    notifyFirstResponse();
  }
}

export function handleConnectorStatusStreamEvent({
  data,
  activeSession,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
}) {
  const { connectorType, connectorName, status } = resolveConnectorStatusPayload(data);
  if (connectorTypeSet?.has?.(connectorType) && connectorName) {
    upsertConnectedConnectorInPanelState(activeSession.value, {
      connectorType,
      connectorName,
      status,
    });
    refreshSessionConnectorsAsync(activeSession.value?.id || "");
  }
}

export function handleAttachmentsStreamEvent({
  data,
  botMessage,
  mergeAssistantAttachments,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
}) {
  const notifyFirstResponse = resolveFirstResponseNavigator({
    navigateOnFirstResponseOnce,
    scrollOnFirstResponseOnce,
  });
  markFirstStreamEvent(botMessage);
  if (!getMessageTurnScopeId(botMessage)) return;
  mergeAssistantAttachments(botMessage, data?.attachments || []);
  notifyFirstResponse();
}

export function handleAttachmentParsedStreamEvent({
  data,
  activeSession,
  makeViewMessage,
}) {
  const incoming = Array.isArray(data?.attachments) ? data.attachments : [];
  if (!incoming.length || !activeSession?.value) return;
  const normalized = typeof makeViewMessage === "function"
    ? makeViewMessage({ attachments: incoming })?.attachments || incoming
    : incoming;
  const messages = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  for (const message of messages) {
    if (message?.role !== "user" || !Array.isArray(message?.attachments)) continue;
    message.attachments = message.attachments.map((existing) => {
      const matching = normalized.find((attachment) => {
        const attachmentId = normalizeTrimmedString(attachment?.attachmentId || attachment?.id);
        const existingAttachmentId = normalizeTrimmedString(existing?.attachmentId || existing?.id);
        const clientAttachmentId = normalizeTrimmedString(attachment?.clientAttachmentId);
        const existingClientAttachmentId = normalizeTrimmedString(existing?.clientAttachmentId);
        const contentSha256 = normalizeTrimmedString(attachment?.contentSha256);
        const existingContentSha256 = normalizeTrimmedString(existing?.contentSha256);
        return Boolean(
          (attachmentId && attachmentId === existingAttachmentId) ||
          (clientAttachmentId && clientAttachmentId === existingClientAttachmentId) ||
          (contentSha256 && contentSha256 === existingContentSha256)
        );
      });
      if (!matching) return existing;
      return {
        ...existing,
        ...(matching?.parsedResult ? { parsedResult: matching.parsedResult } : {}),
        ...(matching?.parsedResultUrl ? { parsedResultUrl: matching.parsedResultUrl } : {}),
        ...(matching?.parsedResultName ? { parsedResultName: matching.parsedResultName } : {}),
        ...(matching?.parsedResultAttachmentId
          ? { parsedResultAttachmentId: matching.parsedResultAttachmentId }
          : {}),
      };
    });
  }
}

export function handleInteractionRequestStreamEvent({
  data,
  clearMissingInteractionPayloadTimer,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
  tryAutoResolveInteraction,
  setPendingInteractionRequest,
}) {
  const notifyFirstResponse = resolveFirstResponseNavigator({
    navigateOnFirstResponseOnce,
    scrollOnFirstResponseOnce,
  });
  const normalizedInteractionRequest = normalizeInteractionRequestPayload({
    ...(data || {}),
    interactionType: normalizeTrimmedString(data?.interactionType),
  });
  clearMissingInteractionPayloadTimer({
    sessionId: normalizeTrimmedString(normalizedInteractionRequest?.sessionId),
    dialogProcessId: normalizeTrimmedString(normalizedInteractionRequest?.dialogProcessId),
  });
  notifyFirstResponse();
  if (tryAutoResolveInteraction(normalizedInteractionRequest)) {
    return true;
  }
  setPendingInteractionRequest(normalizedInteractionRequest);
  return true;
}

export function handleDoneStreamEvent({
  data,
  requestedTextStreaming,
  botMessage,
  activeSession,
  activeSessionId,
  clearPendingInteraction,
  classifyRealtimeLog,
  navigateOnFirstResponseOnce,
  scrollOnFirstResponseOnce,
  makeViewMessage,
  foldMessagesForView,
  mergeAssistantAttachments,
  locateDoneMessage,
  applyConversationState,
  locateSendingStartedMessageOnce,
  suppressCompletionConversationState,
}) {
  const notifyFirstResponse = resolveFirstResponseNavigator({
    navigateOnFirstResponseOnce,
    scrollOnFirstResponseOnce,
  });
  clearPendingInteraction();
  markFirstStreamEvent(botMessage);
  botMessage.dialogProcessId = data?.dialogProcessId || getMessageDialogProcessId(botMessage) || "";
  notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
  const executionSummarySteps = Array.isArray(data?.executionSummary?.steps)
    ? data.executionSummary.steps
    : [];
  const doneExecutionLogSource = executionSummarySteps.length
    ? executionSummarySteps
    : Array.isArray(data?.executionLogs)
      ? data.executionLogs
      : [];
  if (!requestedTextStreaming && doneExecutionLogSource.length) {
    const doneRealtimeLogs = doneExecutionLogSource
      .map((executionLogItem) =>
        classifyRealtimeLog(normalizeExecutionLogForRealtime(executionLogItem)),
      )
      .map((item) => sanitizeExecutionLogForDisplay(item))
      .filter((item) => item && normalizeTrimmedString(item.text))
      .map((item) => ({
        ...item,
        authority: TOOL_TIMELINE_AUTHORITY.COMPATIBILITY,
        sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT,
      }));
    if (doneRealtimeLogs.length) {
      logToolLogWindowDebug("frontend.toolLogWindow.doneClassified", {
        sessionId: String(data?.sessionId || botMessage?.sessionId || ""),
        dialogProcessId: String(data?.dialogProcessId || getMessageDialogProcessId(botMessage) || ""),
        turnScopeId: String(data?.turnScopeId || getMessageTurnScopeId(botMessage) || ""),
        sourceCount: doneExecutionLogSource.length,
        classifiedCount: doneRealtimeLogs.length,
        classified: summarizeToolLogWindow(doneRealtimeLogs),
      });
      botMessage.toolTimeline = fillMissingToolTimelineFacets(
        botMessage.toolTimeline,
        buildToolTimelineFromLegacyLogs(doneRealtimeLogs, {
          sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT,
        }),
      );
      // Tool facts belong exclusively to toolTimeline. Duplicating them into
      // activityTimeline lets legacy tool errors survive as a second row with
      // different fallback ordering.
      botMessage.activityTimeline = doneRealtimeLogs
        .filter((logItem) => !isToolActivityLog(logItem))
        .reduce(
        (timeline, logItem) => reduceActivityTimeline(timeline, logItem),
        botMessage.activityTimeline || [],
      );
      if (!getMessageDialogProcessId(botMessage)) {
        const latestDialogProcessId = [...doneRealtimeLogs]
          .reverse()
          .map((logItem) => normalizeTrimmedString(logItem?.dialogProcessId))
          .find(Boolean);
        if (latestDialogProcessId) {
          botMessage.dialogProcessId = latestDialogProcessId;
          notifySendingStartedWhenDialogReady({ botMessage, locateSendingStartedMessageOnce });
        }
      }
      logToolLogWindowDebug("frontend.toolLogWindow.doneTimelineMerged", {
        sessionId: String(data?.sessionId || botMessage?.sessionId || ""),
        dialogProcessId: String(data?.dialogProcessId || getMessageDialogProcessId(botMessage) || ""),
        turnScopeId: String(data?.turnScopeId || getMessageTurnScopeId(botMessage) || ""),
        timelineEntryCount: botMessage.toolTimeline?.length || 0,
        timelineLogs: summarizeToolLogWindow(selectToolTimelineLogs(botMessage)),
      });
      notifyFirstResponse();
    }
  }
  // Stream/DONE payloads are transport observations, not Session identity
  // reconciliation. List/detail reconciliation owns the one-time promotion
  // from an optimistic local Session id to the canonical backend id.
  activeSession.value.loaded = true;
  applyDoneMessagesPatch({
    data,
    botMessage,
    activeSession,
    makeViewMessage,
    foldMessagesForView,
    mergeAssistantAttachments,
  });
  if (!suppressCompletionConversationState && botMessage?.pending !== false) {
    const turnMeta = normalizeTurnMeta(data);
    applyConversationState?.(
      {
        state: BackendChannelState.COMPLETED,
        sessionId: String(data?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
        dialogProcessId: String(getMessageDialogProcessId(botMessage) || data?.dialogProcessId || ""),
        turnScopeId: String(getMessageTurnScopeId(botMessage) || turnMeta.turnScopeId || ""),
        sourceEvent: "done",
        updatedAtMs: nowMs(),
      },
      { botMessage },
    );
  }
}

export function handleBasicStreamEvent(event, context = {}) {
  if (event === StreamEventEnum.THINKING) {
    handleThinkingStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.DELTA) {
    handleDeltaStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.CONNECTOR_STATUS) {
    handleConnectorStatusStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.ATTACHMENTS) {
    handleAttachmentsStreamEvent(context);
    return true;
  }
  if (event === StreamEventEnum.ATTACHMENT_PARSED) {
    handleAttachmentParsedStreamEvent(context);
    return true;
  }
  return false;
}
