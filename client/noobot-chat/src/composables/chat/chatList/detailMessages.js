/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import {
  buildDialogProcessParentMap,
  flattenSessionMessages,
  mergeAttachments,
  resolveRootDialogProcessIdByChain,
} from "../../infra/dialogProcessChain";
import {
  buildMessageIdentityKey,
  canUseTurnScopedAssets,
  clearTurnScopedAssets,
  findMessageIdentityIndex,
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  getMessageTurnScopeIdKey,
  isAssistantWithoutTurnScope,
  normalizeTurnScopeIdKey,
} from "../../infra/messageIdentity";
import { getMessageAttachments } from "../../infra/messageModel";
import {
  buildToolTimelineFromLegacyLogs,
  countCompletedToolAttachments,
  mergeToolTimelines,
} from "../chatEngine/toolTimeline";
import { adaptLegacyMessageTimelines } from "../chatEngine/legacyTimelineAdapter";
import {
  getMessageRuntimeChannelState,
  isMessageInFlightAssistant,
  resolveSessionRunMessageRuntimeView,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
} from "../sessionRunStateMachine";
import { selectTurnMessageRuntime } from "../sessionRunStateMachine/turnRuntimeRegistry";
import {
  logResendDebug,
  summarizeDebugMessage,
} from "../debug/resendDebugLogger";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../debug/stateMachineLogger";

const TURN_STATUS_PLACEHOLDER_STATES = new Set([
  "user_stopped",
  "error",
  "timeout",
]);

const TURN_STATUS_COMPLETED_STATES = new Set([
  "completed",
]);

const TERMINAL_STOP_CHANNEL_STATES = new Set([
  "user_stopped",
]);

const FINALIZED_ASSISTANT_STATES = new Set([
  "completed",
  "frontend_completed",
  "user_stopped",
  "cancelled",
  "aborted",
  "error",
  "expired",
  "no_conversation",
]);

/**
 * Project authoritative session turn timings onto the turn identity consumed by
 * message renderers. Both the primary chat and secondary Agent viewers must use
 * this projection so refresh-time thinking state cannot diverge by channel.
 */
export function buildTurnTimingsByTurnScopeId({
  turnTimings = [],
  messages = [],
  currentTimingsByTurnScopeId = {},
  onTimingHydrated = null,
} = {}) {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  const currentTimings = currentTimingsByTurnScopeId && typeof currentTimingsByTurnScopeId === "object"
    ? currentTimingsByTurnScopeId
    : {};
  const projectedEntries = (Array.isArray(turnTimings) ? turnTimings : [])
    .map((item = {}) => {
        const timingDialogProcessId = getMessageDialogProcessId(item);
        const matchingMessage = timingDialogProcessId
          ? sourceMessages.find(
            (messageItem) => getMessageDialogProcessId(messageItem) === timingDialogProcessId,
          )
          : null;
        const turnScopeId = getMessageTurnScopeId(item) || getMessageTurnScopeId(matchingMessage);
        const turnScopeKey = normalizeTurnScopeIdKey(turnScopeId);
        const current = currentTimings[turnScopeKey] || currentTimings[turnScopeId] || {};
        const timing = {
          thinkingStartedAt: item?.thinkingStartedAt || current.thinkingStartedAt || null,
          thinkingFinishedAt: item?.thinkingFinishedAt || current.thinkingFinishedAt || null,
        };
        onTimingHydrated?.({ item, matchingMessage, turnScopeId: turnScopeKey || turnScopeId, current, timing });
        return [turnScopeKey || turnScopeId, timing];
      })
    .filter(([turnScopeId]) => Boolean(turnScopeId));
  const projectedTurnScopeIds = new Set(projectedEntries.map(([turnScopeId]) => turnScopeId));
  // A sparse realtime update may omit persisted turnTimings while still
  // carrying the in-flight message. Preserve only timings whose owning turn is
  // present; never leak an orphan timing into another/session-empty projection.
  for (const [turnScopeId, timing] of Object.entries(currentTimings)) {
    const turnScopeKey = normalizeTurnScopeIdKey(turnScopeId);
    if (projectedTurnScopeIds.has(turnScopeKey)) continue;
    if (!sourceMessages.some((messageItem) => getMessageTurnScopeIdKey(messageItem) === turnScopeKey)) continue;
    projectedEntries.push([turnScopeKey, timing]);
  }
  return Object.fromEntries(projectedEntries);
}

function normalizeState(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function resolveTurnStatusKey(item = {}) {
  return normalizeTurnScopeIdKey(item?.turnScopeId || getMessageTurnScopeId(item)) ||
    normalizeText(item?.dialogProcessId || getMessageDialogProcessId(item));
}

function buildTurnStatusMap(turnStatuses = []) {
  const map = new Map();
  for (const item of Array.isArray(turnStatuses) ? turnStatuses : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const normalized = { ...item, status: normalizeState(item.status) };
    const turnScopeId = normalizeTurnScopeIdKey(item.turnScopeId);
    const dialogProcessId = normalizeText(item.dialogProcessId || getMessageDialogProcessId(item));
    if (turnScopeId) map.set(`turn:${turnScopeId}`, normalized);
    if (dialogProcessId) map.set(`dialog:${dialogProcessId}`, normalized);
  }
  return map;
}

function shouldInjectTurnStatusPlaceholder(turnStatus = {}, hasAssistantResponse = false) {
  const status = normalizeState(turnStatus?.status);
  if (!status || TURN_STATUS_COMPLETED_STATES.has(status)) return false;
  if (!TURN_STATUS_PLACEHOLDER_STATES.has(status)) return false;
  return !hasAssistantResponse;
}

function formatTurnStatusPlaceholderContent(turnStatus = {}) {
  const status = normalizeState(turnStatus?.status);
  const description = normalizeText(turnStatus?.description);
  const reason = normalizeText(turnStatus?.reason);
  const errorMessage = normalizeText(
    typeof turnStatus?.error === "string"
      ? turnStatus.error
      : turnStatus?.error?.message || turnStatus?.error?.reason || "",
  );
  const title = status === "user_stopped"
    ? "本轮已由用户停止"
    : status === "timeout"
      ? "本轮已超时停止"
      : "本轮异常停止";
  const details = [description, reason && `原因：${reason}`, errorMessage && `异常：${errorMessage}`]
    .filter(Boolean);
  return [title, ...details].join("\n");
}

function buildTurnStatusPlaceholderMessage(userMessage = {}, turnStatus = {}) {
  const turnScopeId = normalizeText(turnStatus?.turnScopeId || getMessageTurnScopeId(userMessage));
  const dialogProcessId = normalizeText(turnStatus?.dialogProcessId || getMessageDialogProcessId(userMessage));
  const updatedAt = normalizeText(turnStatus?.updatedAt || turnStatus?.createdAt || userMessage?.updatedAt || userMessage?.createdAt);
  return {
    id: `turn-status-placeholder:${turnScopeId || dialogProcessId}`,
    role: RoleEnum.ASSISTANT,
    content: formatTurnStatusPlaceholderContent(turnStatus),
    pending: false,
    synthetic: true,
    placeholder: true,
    turnPlaceholder: true,
    turnStatusPlaceholder: true,
    turnStatus: { ...turnStatus },
    status: turnStatus?.status,
    state: turnStatus?.status,
    statusReason: turnStatus?.reason,
    statusDescription: turnStatus?.description,
    error: turnStatus?.error,
    turnScopeId,
    dialogProcessId,
    parentDialogProcessId: normalizeText(turnStatus?.parentDialogProcessId || userMessage?.parentDialogProcessId),
    createdAt: updatedAt,
    updatedAt,
    ts: updatedAt,
  };
}

export function injectTurnStatusPlaceholders(messages = [], turnStatuses = []) {
  const sourceMessages = Array.isArray(messages) ? messages : [];
  const statusMap = buildTurnStatusMap(turnStatuses);
  if (!sourceMessages.length || !statusMap.size) return sourceMessages;
  const output = [];
  const placeholdersByKey = new Map();
  const assistantResponseKeys = new Set();
  for (const messageItem of sourceMessages) {
    const turnScopeId = normalizeText(getMessageTurnScopeId(messageItem));
    const dialogProcessId = normalizeText(getMessageDialogProcessId(messageItem));
    const keys = [
      turnScopeId ? `turn:${turnScopeId}` : "",
      dialogProcessId ? `dialog:${dialogProcessId}` : "",
    ].filter(Boolean);
    if (messageItem?.turnStatusPlaceholder === true) {
      keys.forEach((key) => placeholdersByKey.set(key, messageItem));
      continue;
    }
    // Only an authoritative, finalized assistant response suppresses the
    // terminal-status placeholder. Keep the placeholder beside partial
    // streamed content so the terminal reason remains visible.
    if (
      getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
      messageItem?.pending === false
    ) {
      keys.forEach((key) => assistantResponseKeys.add(key));
    }
  }
  const injectedKeys = new Set();
  for (const messageItem of sourceMessages) {
    // Reinsert persisted/synthetic placeholders beside their owning user
    // message. Their timestamps may otherwise place them above that message.
    if (messageItem?.turnStatusPlaceholder === true) continue;
    output.push(messageItem);
    if (getMessageRole(messageItem) !== RoleEnum.USER) continue;
    const messageTurnScopeId = normalizeText(getMessageTurnScopeId(messageItem));
    const messageDialogProcessId = normalizeText(getMessageDialogProcessId(messageItem));
    const turnKeys = [
      messageTurnScopeId ? `turn:${messageTurnScopeId}` : "",
      messageDialogProcessId ? `dialog:${messageDialogProcessId}` : "",
    ].filter(Boolean);
    if (!turnKeys.length || turnKeys.some((key) => injectedKeys.has(key))) continue;
    const turnStatus =
      (messageTurnScopeId ? statusMap.get(`turn:${messageTurnScopeId}`) : null) ||
      (messageDialogProcessId ? statusMap.get(`dialog:${messageDialogProcessId}`) : null);
    if (!turnStatus) continue;
    const hasAssistantResponse = turnKeys.some((key) => assistantResponseKeys.has(key));
    if (!shouldInjectTurnStatusPlaceholder(turnStatus, hasAssistantResponse)) continue;
    const existingPlaceholder = turnKeys
      .map((key) => placeholdersByKey.get(key))
      .find(Boolean);
    output.push(existingPlaceholder || buildTurnStatusPlaceholderMessage(messageItem, turnStatus));
    turnKeys.forEach((key) => injectedKeys.add(key));
  }
  return output;
}

function countCompletedToolLogAttachments(messageItem = {}) {
  return countCompletedToolAttachments(adaptLegacyMessageTimelines(messageItem));
}

function isInFlightAssistantMessage(messageItem = {}) {
  return resolveSessionRunMessageRuntimeView(messageItem).inFlightAssistant;
}

function isTerminalStopAssistantDetail(messageItem = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  const states = [
    messageItem?.stopState,
    messageItem?.status,
    messageItem?.state,
    getMessageRuntimeChannelState(messageItem)?.state,
  ].map(normalizeState);
  return states.some((state) => TERMINAL_STOP_CHANNEL_STATES.has(state));
}

function hasReliableCompletedAssistantIdentity(messageItem = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  if (messageItem?.workflowMessage === true) return false;
  if (isInFlightAssistantMessage(messageItem)) return false;
  if (isTerminalStopAssistantDetail(messageItem)) return false;
  return Boolean(getMessageTurnScopeId(messageItem) || getMessageDialogProcessId(messageItem));
}

function isFinalizedAssistantMessage(messageItem = {}) {
  if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
  const state = normalizeState(
    getMessageRuntimeChannelState(messageItem)?.state ||
      messageItem?.status ||
      messageItem?.state ||
      messageItem?.stopState,
  );
  return messageItem?.pending === false && FINALIZED_ASSISTANT_STATES.has(state);
}

function snapshotFrozenAssistantDisplayFields(messageItem = {}) {
  return {
    content: messageItem?.content,
    ts: messageItem?.ts,
    timestamp: messageItem?.timestamp,
    createdAt: messageItem?.createdAt,
    created_at: messageItem?.created_at,
    updatedAt: messageItem?.updatedAt,
    updated_at: messageItem?.updated_at,
    channelState:
      messageItem?.channelState && typeof messageItem.channelState === "object" && !Array.isArray(messageItem.channelState)
        ? { ...messageItem.channelState }
        : messageItem?.channelState,
    status: messageItem?.status,
    state: messageItem?.state,
    stopState: messageItem?.stopState,
  };
}

function restoreFrozenAssistantDisplayFields(messageItem = {}, frozen = null) {
  if (!messageItem || !frozen) return;
  ["content", "ts", "timestamp", "createdAt", "created_at", "updatedAt", "updated_at", "status", "state", "stopState"].forEach((key) => {
    if (frozen[key] !== undefined) messageItem[key] = frozen[key];
  });
  if (frozen.channelState !== undefined) messageItem.channelState = frozen.channelState;
  messageItem.pending = false;
}

function conflictsWithInFlightAssistant(existingMessages = [], detailMessageItem = {}) {
  const detailTurnScopeId = getMessageTurnScopeId(detailMessageItem);
  const detailDialogProcessId = getMessageDialogProcessId(detailMessageItem);
  return (Array.isArray(existingMessages) ? existingMessages : []).some((messageItem) => {
    const existingTurnScopeId = getMessageTurnScopeId(messageItem);
    const existingDialogProcessId = getMessageDialogProcessId(messageItem);
    if (!isInFlightAssistantMessage(messageItem)) return false;
    if (detailTurnScopeId && existingTurnScopeId) return detailTurnScopeId === existingTurnScopeId;
    if (detailDialogProcessId && existingDialogProcessId) return detailDialogProcessId === existingDialogProcessId;
    return false;
  });
}

function preserveRunningThinkingState(
  existingMessage = {},
  detailMessageItem = {},
  { registry = null, sessionId = "" } = {},
) {
  const existingChannelState =
    existingMessage?.channelState &&
    typeof existingMessage.channelState === "object" &&
    !Array.isArray(existingMessage.channelState)
      ? existingMessage.channelState
      : null;
  const existingPending = existingMessage?.pending === true;
  return () => {
    const registryView = selectTurnMessageRuntime(registry, {
      sessionId,
      turnScopeId: getMessageTurnScopeId(existingMessage),
      dialogProcessId: getMessageDialogProcessId(existingMessage),
    });
    const registryObservedTurn = Boolean(registryView?.source);
    const runtimeView = registryObservedTurn
      ? { ...registryView, inFlightAssistant: registryView.running === true }
      : resolveSessionRunMessageRuntimeView(existingMessage);
    if (runtimeView.inFlightAssistant) {
      if (existingChannelState && !detailMessageItem?.channelState) {
        existingMessage.channelState = existingChannelState;
      }
    } else if (registryObservedTurn || runtimeView.source === "persisted") {
      // Once the runtime registry has observed this Turn, its running flag owns
      // the message projection. In particular, an authoritative terminal
      // resolution must clear stale optimistic sending state regardless of the
      // registry event source label. Message appearance is only a bootstrap
      // fallback for Turns absent from the registry.
      delete existingMessage.channelState;
      existingMessage.pending = false;
    }
    if (existingPending && runtimeView.inFlightAssistant) {
      existingMessage.pending = true;
    }
  };
}

export function buildWorkflowMessageSignature(messageItem = {}) {
  const workflowMeta =
    messageItem?.workflowMeta &&
    typeof messageItem.workflowMeta === "object" &&
    !Array.isArray(messageItem.workflowMeta)
      ? messageItem.workflowMeta
      : {};
  const semanticPreview = String(
    workflowMeta?.semanticTextPreview ||
      workflowMeta?.payload?.interaction?.semanticTextPreview ||
      "",
  ).trim();
  return [
    getMessageDialogProcessId(messageItem),
    String(messageItem?.content || "").trim(),
    semanticPreview,
  ].join("|");
}

export function patchExistingWorkflowMessage(existingMessage = null, workflowMessageItem = {}) {
  if (!existingMessage || !workflowMessageItem) return false;
  Object.assign(existingMessage, workflowMessageItem);
  existingMessage.pending = false;
  existingMessage.workflowMessage = true;
  return true;
}

export function normalizeMessageContent(value = "") {
  return String(value || "").trim();
}

export function normalizeMessageRole(messageItem = {}) {
  return getMessageRole(messageItem);
}

export function buildMessageIdentity(messageItem = {}) {
  return buildMessageIdentityKey(messageItem);
}

function isInlineEditingUserMessage(messageItem = {}) {
  return (
    normalizeMessageRole(messageItem) === RoleEnum.USER &&
    messageItem?.__monotonicEditing === true
  );
}

export function findExistingMessageIndexForDetailMessage(existingMessages = [], detailMessageItem = {}) {
  if (buildMessageIdentity(detailMessageItem)) {
    const identityIndex = findMessageIdentityIndex(detailMessageItem, existingMessages);
    if (identityIndex >= 0) return identityIndex;
  }
  const detailRole = normalizeMessageRole(detailMessageItem);
  const detailTurnScopeId = getMessageTurnScopeId(detailMessageItem);
  if (detailTurnScopeId) {
    const matchingTurnIndexes = existingMessages
      .map((messageItem, index) => ({ messageItem, index }))
      .filter(({ messageItem }) =>
        normalizeMessageRole(messageItem) === detailRole &&
        getMessageTurnScopeId(messageItem) === detailTurnScopeId,
      )
      .map(({ index }) => index);
    if (matchingTurnIndexes.length === 1) return matchingTurnIndexes[0];
  }
  // Session-detail hydration is the isolated migration boundary for legacy
  // optimistic messages created before a turnScopeId was available. Reuse a
  // unique same-role message from the same execution chain only when at least
  // one side has no Turn identity. Never use dialogProcessId to join two
  // explicitly identified (and potentially different) Turns.
  const detailDialogProcessId = getMessageDialogProcessId(detailMessageItem);
  if (detailDialogProcessId) {
    const matchingLegacyDialogIndexes = existingMessages
      .map((messageItem, index) => ({ messageItem, index }))
      .filter(({ messageItem }) => {
        if (normalizeMessageRole(messageItem) !== detailRole) return false;
        if (getMessageDialogProcessId(messageItem) !== detailDialogProcessId) return false;
        const existingTurnScopeId = getMessageTurnScopeId(messageItem);
        return !detailTurnScopeId || !existingTurnScopeId;
      })
      .map(({ index }) => index);
    if (matchingLegacyDialogIndexes.length === 1) return matchingLegacyDialogIndexes[0];
  }
  if (detailRole !== RoleEnum.USER) return -1;
  const matchingUserIndexes = existingMessages
    .map((messageItem, index) => ({ messageItem, index }))
    .filter(({ messageItem }) => {
      if (normalizeMessageRole(messageItem) !== RoleEnum.USER) return false;
      return !buildMessageIdentity(messageItem);
    })
    .map(({ index }) => index);
  return matchingUserIndexes.length === 1 ? matchingUserIndexes[0] : -1;
}

export function mergePreservedDetailMessages(
  existingMessages = [],
  detailMessages = [],
  { registry = null, sessionId = "" } = {},
) {
  if (!Array.isArray(existingMessages) || !Array.isArray(detailMessages) || !detailMessages.length) {
    return;
  }
  for (const detailMessageItem of detailMessages) {
    if (detailMessageItem?.workflowMessage === true) continue;
    const detailIdentity = buildMessageIdentity(detailMessageItem);
    const existingIndex = findExistingMessageIndexForDetailMessage(existingMessages, detailMessageItem);
    if (existingIndex >= 0) {
      const existingMessage = existingMessages[existingIndex];
      const existingRuntime = selectTurnMessageRuntime(registry, {
        sessionId,
        turnScopeId: getMessageTurnScopeId(existingMessage),
        dialogProcessId: getMessageDialogProcessId(existingMessage),
      });
      const registryConfirmsInFlight = existingRuntime?.source && existingRuntime.running === true;
      logResendDebug("detail.merge.match", {
        identity: detailIdentity,
        existingIndex,
        existing: summarizeDebugMessage(existingMessage),
        detail: summarizeDebugMessage(detailMessageItem),
      });
      if (
        registryConfirmsInFlight &&
        (detailMessageItem?.turnStatusPlaceholder === true || isTerminalStopAssistantDetail(detailMessageItem))
      ) {
        logResendDebug("detail.merge.skipStoppedOverInFlight", {
          identity: detailIdentity,
          existingIndex,
          existing: summarizeDebugMessage(existingMessage),
          detail: summarizeDebugMessage(detailMessageItem),
        });
        continue;
      }
      const keepInlineEditingContent = isInlineEditingUserMessage(existingMessage);
      const inlineEditingContent = keepInlineEditingContent
        ? existingMessage.content
        : undefined;
      const runtimeStateMark = existingMessage?.[SESSION_RUN_MESSAGE_RUNTIME_MARK];
      const runtimeMark = existingMessage?.runtimeMark;
      const existingAttachments = getMessageAttachments(existingMessage);
      const detailAttachments = getMessageAttachments(detailMessageItem);
      const completedToolLogAttachmentsBefore = countCompletedToolLogAttachments(existingMessage);
      const completedToolLogAttachmentsDetail = countCompletedToolLogAttachments(detailMessageItem);
      const restoreRunningThinkingState = preserveRunningThinkingState(
        existingMessage,
        detailMessageItem,
        { registry, sessionId },
      );
      const frozenAssistantDisplayFields = isFinalizedAssistantMessage(existingMessage)
        ? snapshotFrozenAssistantDisplayFields(existingMessage)
        : null;
      Object.assign(existingMessage, detailMessageItem);
      logResendDebug("detail.merge.assign", {
        identity: detailIdentity,
        existingIndex,
        before: summarizeDebugMessage({ ...existingMessage, ...detailMessageItem }),
        detail: summarizeDebugMessage(detailMessageItem),
      });
      if (keepInlineEditingContent) {
        existingMessage.content = inlineEditingContent;
        existingMessage.__monotonicEditing = true;
      }
      if (existingAttachments.length || detailAttachments.length) {
        existingMessage.attachments = detailAttachments.length
          ? mergeAttachments(existingAttachments, detailAttachments)
          : existingAttachments;
      }
      if (runtimeStateMark && !existingMessage[SESSION_RUN_MESSAGE_RUNTIME_MARK]) {
        existingMessage[SESSION_RUN_MESSAGE_RUNTIME_MARK] = runtimeStateMark;
      }
      if (runtimeMark && !existingMessage.runtimeMark) {
        existingMessage.runtimeMark = runtimeMark;
      }
      restoreFrozenAssistantDisplayFields(existingMessage, frozenAssistantDisplayFields);
      const attachmentsAfter = getMessageAttachments(existingMessage);
      const completedToolLogAttachmentsAfter = countCompletedToolLogAttachments(existingMessage);
      logStateMachineDebug("detailApply.merge.runtimeAndAttachments", {
        identity: detailIdentity,
        existingIndex,
        message: summarizeStateMachineMessage(existingMessage),
        hasRuntimeMarkBefore: Boolean(runtimeStateMark || runtimeMark),
        hasRuntimeMarkAfter: Boolean(existingMessage?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || existingMessage?.runtimeMark),
        runtimeMarkPreserved: Boolean((runtimeStateMark && existingMessage?.[SESSION_RUN_MESSAGE_RUNTIME_MARK]) || (runtimeMark && existingMessage?.runtimeMark)),
        attachmentsCountBefore: existingAttachments.length,
        attachmentsCountDetail: detailAttachments.length,
        attachmentsCountAfter: attachmentsAfter.length,
        completedToolLogAttachmentsCountBefore: completedToolLogAttachmentsBefore,
        completedToolLogAttachmentsCountDetail: completedToolLogAttachmentsDetail,
        completedToolLogAttachmentsCountAfter: completedToolLogAttachmentsAfter,
      });
      existingMessage.pending = false;
      restoreRunningThinkingState();
      continue;
    }
    if (
      hasReliableCompletedAssistantIdentity(detailMessageItem) &&
      !conflictsWithInFlightAssistant(existingMessages, detailMessageItem, { registry, sessionId })
    ) {
      existingMessages.push(detailMessageItem);
    } else {
      logStateMachineDebug("detailApply.merge.notAppended", {
        identity: detailIdentity,
        detail: summarizeStateMachineMessage(detailMessageItem),
        attachmentsCountDetail: getMessageAttachments(detailMessageItem).length,
        completedToolLogAttachmentsCountDetail: countCompletedToolLogAttachments(detailMessageItem),
        hasReliableCompletedAssistantIdentity: hasReliableCompletedAssistantIdentity(detailMessageItem),
        conflictsWithInFlightAssistant: conflictsWithInFlightAssistant(
          existingMessages,
          detailMessageItem,
          { registry, sessionId },
        ),
      });
    }
  }
}

export function buildNormalizedDetailMessages({
  detailMessages = [],
  sessionDocs = [],
  rootSessionId = "",
  turnTimings = [],
  turnStatuses = [],
  makeViewMessage,
  foldMessagesForView,
  isSummaryDetail = false,
} = {}) {
  const sourceMessages = Array.isArray(detailMessages) ? detailMessages : [];
  const normalizedMessages = isSummaryDetail
    ? sourceMessages.map((messageItem) => makeViewMessage(messageItem))
    : foldMessagesForView(sourceMessages);
  if (!isSummaryDetail) {
    mergeChildTurnAttachmentsIntoRootMessages({
      rootMessages: normalizedMessages,
      sessionDocs,
      rootSessionId,
      makeViewMessage,
    });
  }
  const messagesWithPlaceholders = injectTurnStatusPlaceholders(normalizedMessages, turnStatuses);
  applyStatusTurnScopeIds({
    messages: messagesWithPlaceholders,
    sessionDocs,
    turnStatuses,
  });
  return messagesWithPlaceholders;
}

export function applyStatusTurnScopeIds({ messages = [], sessionDocs = [], turnStatuses = [] } = {}) {
  const statusByDialogProcessId = new Map(
    (Array.isArray(turnStatuses) ? turnStatuses : [])
      .map((status) => [
        normalizeText(status?.dialogProcessId || getMessageDialogProcessId(status)),
        status,
      ])
      .filter(([dialogProcessId, status]) => dialogProcessId && normalizeText(status?.turnScopeId)),
  );
  if (!statusByDialogProcessId.size) return messages;
  const allMessages = [
    ...(Array.isArray(messages) ? messages : []),
    ...flattenSessionMessages(sessionDocs),
  ];
  const parentByDialogProcessId = buildDialogProcessParentMap(allMessages);
  const rootDialogProcessIdSet = new Set(statusByDialogProcessId.keys());
  for (const messageItem of Array.isArray(messages) ? messages : []) {
    const dialogProcessId = getMessageDialogProcessId(messageItem);
    if (!dialogProcessId) continue;
    const rootDialogProcessId = rootDialogProcessIdSet.has(dialogProcessId)
      ? dialogProcessId
      : resolveRootDialogProcessIdByChain({
        startDialogProcessId: dialogProcessId,
        rootDialogProcessIdSet,
        parentByDialogProcessId,
      });
    const turnStatus = statusByDialogProcessId.get(rootDialogProcessId);
    const statusTurnScopeId = normalizeText(turnStatus?.turnScopeId);
    if (statusTurnScopeId) {
      messageItem.statusTurnScopeId = statusTurnScopeId;
      // Persisted turnStatuses is the refresh-time source of truth. Project the
      // display state with the identity so rendering does not depend on Registry
      // hydration order after a reload.
      messageItem.persistedStatusStepState = normalizeText(turnStatus?.status);
    }
  }
  return messages;
}

export function buildChildAttachmentsByParentDialogProcessId({
  sessionDocs = [],
  rootSessionId = "",
  rootMessages = [],
  makeViewMessage,
} = {}) {
  const output = new Map();
  const rootDialogProcessIdSet = new Set(
    (Array.isArray(rootMessages) ? rootMessages : [])
      .filter((messageItem) =>
        getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
        getMessageTurnScopeId(messageItem),
      )
      .map((messageItem) => getMessageDialogProcessId(messageItem))
      .filter(Boolean),
  );
  if (!rootDialogProcessIdSet.size) return output;
  const parentByDialogProcessId = buildDialogProcessParentMap(
    flattenSessionMessages(sessionDocs),
  );
  for (const sessionDoc of Array.isArray(sessionDocs) ? sessionDocs : []) {
    const sessionId = String(sessionDoc?.sessionId || "").trim();
    if (!sessionId || sessionId === String(rootSessionId || "").trim()) continue;
    const messageList = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
    for (const messageItem of messageList) {
      const normalizedAttachments = getMessageAttachments(makeViewMessage(messageItem));
      if (!normalizedAttachments.length) continue;
      const parentDialogProcessId = String(
        messageItem?.parentDialogProcessId || "",
      ).trim();
      if (!parentDialogProcessId) continue;
      const rootDialogProcessId = resolveRootDialogProcessIdByChain({
        startDialogProcessId: parentDialogProcessId,
        rootDialogProcessIdSet,
        parentByDialogProcessId,
      });
      if (!rootDialogProcessId) continue;
      const mergedAttachments = mergeAttachments(
        output.get(rootDialogProcessId) || [],
        normalizedAttachments,
      );
      output.set(rootDialogProcessId, mergedAttachments);
    }
  }
  return output;
}

export function mergeChildTurnAttachmentsIntoRootMessages({
  rootMessages = [],
  sessionDocs = [],
  rootSessionId = "",
  makeViewMessage,
} = {}) {
  const messages = Array.isArray(rootMessages) ? rootMessages : [];
  if (!messages.length) return messages;
  const childAttachmentsByParentDialogProcessId =
    buildChildAttachmentsByParentDialogProcessId({
      sessionDocs,
      rootSessionId,
      rootMessages: messages,
      makeViewMessage,
    });
  if (!childAttachmentsByParentDialogProcessId.size) return messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index];
    if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
    if (isAssistantWithoutTurnScope(messageItem)) {
      clearTurnScopedAssets(messageItem);
      continue;
    }
    const dialogProcessId = getMessageDialogProcessId(messageItem);
    if (!dialogProcessId) continue;
    const childAttachments =
      childAttachmentsByParentDialogProcessId.get(dialogProcessId) || [];
    if (!childAttachments.length) continue;
    messageItem.attachments = mergeAttachments(
      getMessageAttachments(messageItem),
      childAttachments,
    );
  }
  return messages;
}

export function applySummaryToolLogs(sessionItem, sessionDocs = []) {
  const logsByTurnScopeId = new Map();
  for (const sessionDoc of sessionDocs) {
    for (const logItem of Array.isArray(sessionDoc?.toolLogSummaries) ? sessionDoc.toolLogSummaries : []) {
      const turnScopeId = getMessageTurnScopeId(logItem);
      // Summary documents are an isolated legacy input boundary. Unscoped
      // records cannot be assigned to a UI turn and must never fall back to a
      // reusable dialog execution-chain id.
      if (!turnScopeId) continue;
      logsByTurnScopeId.set(turnScopeId, [
        ...(logsByTurnScopeId.get(turnScopeId) || []),
        logItem,
      ]);
    }
  }
  for (const messageItem of sessionItem.messages || []) {
    if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
    if (!canUseTurnScopedAssets(messageItem)) {
      clearTurnScopedAssets(messageItem);
      continue;
    }
    const turnScopeId = getMessageTurnScopeId(messageItem);
    const logs = logsByTurnScopeId.get(turnScopeId) || [];
    messageItem.toolTimeline = mergeToolTimelines(
      messageItem.toolTimeline,
      buildToolTimelineFromLegacyLogs(logs),
    );
  }
}
