/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getCurrentScope, onScopeDispose } from "vue";
import { normalizeSelectedConnectors } from "../../shared/models/sessionModel";
import { promoteSessionIdentityToBackendId } from "../infra/sessionIdentity";
import { RoleEnum, StreamEventEnum } from "../../shared/constants/chatConstants";
import { useLocale } from "../../shared/i18n/useLocale";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";
import {
  isAutoResolvedInteraction,
  normalizeInteractionRequestPayload,
  resolveConnectorConnectedPayload,
  resolveConnectorStatusPayload,
} from "./interactionPayload";

function pickAssistantMessagesForCurrentTurn({ foldedMessages = [], dialogProcessId = "" }) {
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  const messageList = Array.isArray(foldedMessages) ? foldedMessages : [];
  const lastUserMessageIndex = (() => {
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      if (String(messageList[messageIndex]?.role || "") === RoleEnum.USER) {
        return messageIndex;
      }
    }
    return -1;
  })();
  const assistantMessagesAfterLastUser = messageList.filter(
    (messageItem, messageIndex) =>
      messageIndex > lastUserMessageIndex &&
      String(messageItem?.role || "") === RoleEnum.ASSISTANT,
  );
  if (!assistantMessagesAfterLastUser.length) return [];
  if (!normalizedDialogProcessId) return assistantMessagesAfterLastUser;
  const matchedMessages = assistantMessagesAfterLastUser.filter(
    (messageItem) =>
      String(messageItem?.dialogProcessId || "").trim() === normalizedDialogProcessId,
  );
  return matchedMessages.length ? matchedMessages : assistantMessagesAfterLastUser;
}

function mergeAssistantContents(assistantMessages = []) {
  const contentList = [];
  for (const assistantMessage of assistantMessages) {
    const content = String(assistantMessage?.content || "").trim();
    if (!content) continue;
    if (contentList[contentList.length - 1] === content) continue;
    contentList.push(content);
  }
  return contentList.join("\n\n");
}

function buildWorkflowMessageSignature(messageItem = {}) {
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
    String(messageItem?.dialogProcessId || "").trim(),
    String(messageItem?.ts || "").trim(),
    String(messageItem?.content || "").trim(),
    semanticPreview,
  ].join("|");
}

function normalizeExecutionLogForRealtime(logItem = {}) {
  const data = logItem?.data && typeof logItem.data === "object" ? logItem.data : {};
  const rawEvent = String(logItem?.event || "").trim();
  const text = String(data?.text || "").trim();
  return {
    ...data,
    event: String(data?.event || rawEvent || "system").trim() || "system",
    type: String(data?.type || logItem?.type || "system").trim() || "system",
    category: String(data?.category || logItem?.category || "system").trim() || "system",
    dialogProcessId: String(
      data?.dialogProcessId || logItem?.dialogProcessId || "",
    ).trim(),
    ts: String(data?.ts || logItem?.ts || "").trim() || new Date().toISOString(),
    text: text || (rawEvent ? `[${rawEvent}]` : ""),
  };
}

export function useChatEngine({
  userId,
  allowUserInteraction,
  forceTool,
  streamOutput,
  botScenario,
  selectedPlugins,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  activeSession,
  activeSessionId,
  sending,
  input,
  uploadFiles,
  clearUploads,
  serializeAttachments,
  appendMessage,
  makeViewMessage,
  foldMessagesForView,
  fetchSessionDetail,
  applySessionDetail,
  refreshSessionConnectorsAsync,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  pendingInteractionRequest,
  interactionSubmitting,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  setPendingInteractionRequest,
  submitInteractionResponse,
  refreshSessionsAsync,
  onConversationState,
  chatWebSocketClient,
  ensureConnected,
  notify = () => {},
} = {}) {
  const { translate, locale } = useLocale();
  let cacheExpiredRefreshTimer = null;
  const connectorConnectedAckedRequestIds = new Set();

  function applyAssistantFailureState(targetAssistantMessage, errorMessage = "") {
    if (!targetAssistantMessage) return;
    targetAssistantMessage.pending = false;
    targetAssistantMessage.statusLabel = translate("chat.failed");
    targetAssistantMessage.error = String(errorMessage || "").trim();
    if (!String(targetAssistantMessage.content || "").trim()) {
      targetAssistantMessage.content = `> ${translate("chat.occurredError", {
        error: targetAssistantMessage.error || translate("chat.unknownError"),
      })}`;
    }
  }

  function tryAutoResolveInteraction(rawRequest = {}) {
    const request = normalizeInteractionRequestPayload(rawRequest || {});
    if (!isAutoResolvedInteraction(request)) {
      return false;
    }
    const requestId = String(request?.requestId || "").trim();
    if (requestId && connectorConnectedAckedRequestIds.has(requestId)) {
      return true;
    }
    if (String(request?.interactionType || "").trim() === "connector_connected") {
      const { connectorType, connectorName, status } = resolveConnectorConnectedPayload(request);
      if (connectorTypeSet.has(connectorType) && connectorName) {
        upsertConnectedConnectorInPanelState(activeSession.value, {
          connectorType,
          connectorName,
          status,
        });
        refreshSessionConnectorsAsync(activeSession.value?.id || "");
      }
    }
    try {
      if (request?.requestId) {
        submitInteractionResponse(
          {
            confirmed: true,
            response: String(request?.interactionType || "").trim()
              ? `${String(request.interactionType).trim()}_ack`
              : "interaction_auto_ack",
          },
          {
            requestId: request.requestId,
            requireEncryption: request.requireEncryption === true,
            sessionId: String(request.sessionId || ""),
          },
        );
      }
    } catch {}
    if (requestId) connectorConnectedAckedRequestIds.add(requestId);
    clearPendingInteraction();
    return true;
  }

  function emitSyntheticErrorConversationState({
    sessionId = "",
    dialogProcessId = "",
    sourceEvent = "",
  } = {}) {
    if (typeof onConversationState !== "function") return;
    onConversationState({
      source: "stream",
      state: "error",
      sessionId: String(sessionId || "").trim(),
      dialogProcessId: String(dialogProcessId || "").trim(),
      sourceEvent: String(sourceEvent || "").trim(),
      seq: 0,
      applied: true,
    });
  }

  function scheduleCacheExpiredSessionRefresh({
    sessionId = "",
    dialogProcessId = "",
    targetAssistantMessage = null,
  } = {}) {
    if (cacheExpiredRefreshTimer) clearTimeout(cacheExpiredRefreshTimer);
    cacheExpiredRefreshTimer = setTimeout(() => {
      cacheExpiredRefreshTimer = null;
      if (typeof refreshSessionsAsync !== "function") return;
      Promise.resolve(
        refreshSessionsAsync(String(activeSessionId.value || ""), {
          silent: true,
          preserveCurrentMessages: true,
        }),
      )
        .then((ok) => {
          if (ok !== false) return;
          sending.value = false;
          interactionSubmitting.value = false;
          clearPendingInteraction();
          const expiredErrorMessage = translate("chat.expiredRefreshFailed");
          applyAssistantFailureState(targetAssistantMessage, expiredErrorMessage);
          emitSyntheticErrorConversationState({
            sessionId: String(sessionId || activeSession.value?.id || "").trim(),
            dialogProcessId,
            sourceEvent: "expired_refresh_failed",
          });
          notify({ type: "error", message: expiredErrorMessage });
        })
        .catch(() => {
          sending.value = false;
          interactionSubmitting.value = false;
          clearPendingInteraction();
          const expiredErrorMessage = translate("chat.expiredRefreshFailed");
          applyAssistantFailureState(targetAssistantMessage, expiredErrorMessage);
          emitSyntheticErrorConversationState({
            sessionId: String(sessionId || activeSession.value?.id || "").trim(),
            dialogProcessId,
            sourceEvent: "expired_refresh_failed",
          });
          notify({ type: "error", message: expiredErrorMessage });
        });
    }, 1200);
  }
  function isInFlightConversationState(state = "") {
    return ["sending", "interaction_pending", "stopping", "reconnecting"].includes(
      String(state || "").trim(),
    );
  }

  function isTerminalConversationState(state = "") {
    return ["stopped", "completed", "error", "no_conversation", "expired"].includes(
      String(state || "").trim(),
    );
  }

  function isStateForActiveSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return true;
    return (
      normalizedSessionId === String(activeSession.value?.id || "").trim() ||
      normalizedSessionId === String(activeSession.value?.backendSessionId || "").trim()
    );
  }

  function findTargetAssistantMessage({ botMessage = null, dialogProcessId = "" } = {}) {
    if (botMessage && String(botMessage?.role || "").trim() === RoleEnum.ASSISTANT) {
      return botMessage;
    }
    const messageList = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    const normalizedDpId = String(dialogProcessId || "").trim();
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const messageItem = messageList[messageIndex];
      if (String(messageItem?.role || "").trim() !== RoleEnum.ASSISTANT) continue;
      if (
        normalizedDpId &&
        String(messageItem?.dialogProcessId || "").trim() &&
        String(messageItem?.dialogProcessId || "").trim() !== normalizedDpId
      ) {
        continue;
      }
      return messageItem;
    }
    return null;
  }

  function applyConversationState(
    statePayload = {},
    { botMessage = null, fallbackDialogProcessId = "" } = {},
  ) {
    const state = String(statePayload?.state || "").trim();
    if (!state) return;
    const sessionId = String(statePayload?.sessionId || "").trim();
    const messageList = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    const botMessageInActiveSession = Boolean(
      botMessage &&
      String(botMessage?.role || "").trim() === RoleEnum.ASSISTANT &&
      messageList.includes(botMessage),
    );
    const forActiveSession = isStateForActiveSession(sessionId) || botMessageInActiveSession;
    if (typeof onConversationState === "function") {
      onConversationState({
        source: "stream",
        state,
        sessionId,
        dialogProcessId: String(
          statePayload?.dialogProcessId || fallbackDialogProcessId || "",
        ).trim(),
        sourceEvent: String(statePayload?.sourceEvent || "").trim(),
        seq: Number(statePayload?.seq || 0),
        applied: forActiveSession,
      });
    }
    if (!forActiveSession) return;
    const dialogProcessId = String(
      statePayload?.dialogProcessId || fallbackDialogProcessId || "",
    ).trim();
    const targetAssistantMessage = findTargetAssistantMessage({
      botMessage,
      dialogProcessId,
    });
    if (
      dialogProcessId &&
      targetAssistantMessage &&
      !String(targetAssistantMessage?.dialogProcessId || "").trim()
    ) {
      targetAssistantMessage.dialogProcessId = dialogProcessId;
    }
    if (isInFlightConversationState(state)) {
      sending.value = true;
      if (
        state === "sending" &&
        String(statePayload?.sourceEvent || "").trim().toLowerCase() === "interaction_response" &&
        typeof clearPendingInteractionIfObsolete === "function"
      ) {
        clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
      }
      if (state === "interaction_pending") {
        interactionSubmitting.value = false;
        const pendingInteractionPayload =
          statePayload?.pendingInteraction &&
          typeof statePayload.pendingInteraction === "object"
            ? statePayload.pendingInteraction
            : null;
        if (pendingInteractionPayload) {
          const normalizedPendingInteractionRequest = normalizeInteractionRequestPayload({
            ...pendingInteractionPayload,
            interactionType: String(
              pendingInteractionPayload?.interactionType || "",
            ).trim(),
          });
          if (!tryAutoResolveInteraction(normalizedPendingInteractionRequest)) {
            setPendingInteractionRequest(normalizedPendingInteractionRequest);
          }
        } else {
          sending.value = false;
          clearPendingInteraction();
          const missingInteractionError = translate("chat.interactionPayloadMissing");
          applyAssistantFailureState(targetAssistantMessage, missingInteractionError);
          emitSyntheticErrorConversationState({
            sessionId,
            dialogProcessId,
            sourceEvent: "interaction_payload_missing",
          });
          notify({ type: "error", message: missingInteractionError });
          return;
        }
      }
      if (targetAssistantMessage) {
        targetAssistantMessage.pending = true;
        if (state === "stopping") {
          targetAssistantMessage.statusLabel = translate("chat.stopping");
        } else if (state === "reconnecting") {
          targetAssistantMessage.statusLabel = translate("chat.reconnecting");
        } else if (state === "sending") {
          targetAssistantMessage.statusLabel = "";
        }
      }
      return;
    }
    if (!isTerminalConversationState(state)) return;
    sending.value = false;
    if (typeof clearPendingInteractionIfObsolete === "function") {
      clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
    }
    if (!pendingInteractionRequest.value) {
      interactionSubmitting.value = false;
    }
    if (state === "expired") {
      scheduleCacheExpiredSessionRefresh({ sessionId, dialogProcessId, targetAssistantMessage });
    }
    if (state === "no_conversation" || state === "expired") {
      clearPendingInteraction();
      return;
    }
    if (!targetAssistantMessage) return;
    targetAssistantMessage.pending = false;
    if (state === "completed") {
      targetAssistantMessage.statusLabel = translate("chat.generated");
      return;
    }
    if (state === "stopped") {
      targetAssistantMessage.statusLabel = translate("chat.stopped");
      if (!String(targetAssistantMessage.content || "").trim()) {
        targetAssistantMessage.content = translate("chat.stoppedContent");
      }
      return;
    }
    if (state === "error") {
      targetAssistantMessage.statusLabel = translate("chat.failed");
    }
  }

  function applyConversationStateFromEvent(
    eventName = "",
    eventData = {},
    { botMessage = null, fallbackDialogProcessId = "" } = {},
  ) {
    const normalizedEvent = String(eventName || "").trim();
    if (normalizedEvent !== StreamEventEnum.CHANNEL_STATE) return;
    applyConversationState(eventData, { botMessage, fallbackDialogProcessId });
  }

  function forceStopUiFinalize() {
    if (!sending.value) return;
    const pendingAssistantMessage = findTargetAssistantMessage();
    applyConversationState(
      {
        state: "stopped",
        sessionId: String(activeSession.value?.backendSessionId || activeSession.value?.id || ""),
        dialogProcessId: String(pendingAssistantMessage?.dialogProcessId || ""),
      },
      { botMessage: pendingAssistantMessage },
    );
    sending.value = false;
    chatWebSocketClient.clearLastReceivedSeqMap();
    chatWebSocketClient.dispose();
  }

  function stopSending() {
    if (!sending.value) return false;
    const pendingAssistantMessage = [...(activeSession.value?.messages || [])]
      .reverse()
      .find(
        (messageItem) =>
          String(messageItem?.role || "").trim() === RoleEnum.ASSISTANT &&
          Boolean(messageItem?.pending),
      );
    return chatWebSocketClient.requestStop(
      {
        partialAssistant: {
          content: String(pendingAssistantMessage?.content || ""),
          dialogProcessId: String(pendingAssistantMessage?.dialogProcessId || ""),
          modelAlias: String(pendingAssistantMessage?.modelAlias || ""),
          modelName: String(pendingAssistantMessage?.modelName || ""),
        },
      },
      forceStopUiFinalize,
    );
  }

  async function send() {
    if (!ensureConnected()) return;
    if (sending.value || !activeSession.value) return;
    if (!input.value.trim() && uploadFiles.value.length === 0) return;

    sending.value = true;
    const text = input.value.trim();
    input.value = "";

    const filesToSend = [...uploadFiles.value];
    const userAttachments = filesToSend.map((fileItem) => ({
      name: fileItem.name,
      mimeType: fileItem.mimeType,
      size: fileItem.size,
      previewUrl: isImageMime(fileItem.mimeType || "")
        ? URL.createObjectURL(fileItem.raw)
        : "",
    }));
    appendMessage(RoleEnum.USER, text || translate("chat.uploadOnly"), userAttachments);
    if (
      [
        String(translate("chat.newSession") || "").trim(),
        String(zhCNMessages?.chat?.newSession || "").trim(),
        String(enUSMessages?.chat?.newSession || "").trim(),
      ].includes(String(activeSession.value.title || "").trim()) &&
      text
    ) {
      activeSession.value.title = text.slice(0, 20);
    }

    const botMsg = appendMessage(RoleEnum.ASSISTANT, "");
    botMsg.pending = true;
    botMsg.statusLabel = "";
    botMsg.executionLogTotal = Number(botMsg.executionLogTotal || 0);
    applyConversationState(
      {
        state: "sending",
        sessionId: String(activeSession.value?.backendSessionId || activeSession.value?.id || ""),
      },
      { botMessage: botMsg },
    );
    let scrolledOnFirstResponse = false;
    const scrollOnFirstResponseOnce = () => {
      if (scrolledOnFirstResponse) return;
      scrolledOnFirstResponse = true;
      scrollBottom();
    };

    try {
      clearUploads();
      const attachments = await serializeAttachments(filesToSend);
      let finalDoneEventData = null;
      const requestedTextStreaming = streamOutput?.value !== false;

      const payload = {
        userId: userId.value,
        sessionId: activeSession.value.backendSessionId || activeSession.value.id,
        message: text || translate("chat.uploadHint"),
        attachments,
        config: {
          allowUserInteraction: allowUserInteraction?.value === false ? false : true,
          forceTool: forceTool?.value === true,
          streaming: requestedTextStreaming,
          ...(String(botScenario?.value || "").trim()
            ? { scenario: String(botScenario?.value || "").trim() }
            : {}),
          locale: String(locale.value || "").trim(),
          selectedConnectors: normalizeSelectedConnectors(
            activeSession.value?.connectorPanelState?.selectedConnectors || {},
          ),
          selectedPlugins: (Array.isArray(selectedPlugins?.value)
            ? selectedPlugins.value
            : []
          )
            .map((pluginKey) => String(pluginKey || "").trim())
            .filter(Boolean),
        },
      };

      await chatWebSocketClient.stream(payload, ({ event, data }) => {
        applyConversationStateFromEvent(event, data || {}, {
          botMessage: botMsg,
          fallbackDialogProcessId: String(botMsg.dialogProcessId || "").trim(),
        });
        if (event === StreamEventEnum.CHANNEL_STATE) {
          return;
        }
        if (event === StreamEventEnum.THINKING) {
          const item = classifyRealtimeLog(data);
          if (!item.subAgentCall && item.dialogProcessId) {
            botMsg.dialogProcessId = item.dialogProcessId;
          }
          botMsg.executionLogTotal = Number(botMsg.executionLogTotal || 0) + 1;
          botMsg.realtimeLogs = [...(botMsg.realtimeLogs || []), item].slice(-10);
          scrollOnFirstResponseOnce();
        } else if (event === StreamEventEnum.DELTA) {
          const chunkText = String(data.text || "");
          if (data?.dialogProcessId && !String(botMsg.dialogProcessId || "").trim()) {
            botMsg.dialogProcessId = String(data.dialogProcessId || "").trim();
          }
          botMsg.content += chunkText;
          if (chunkText) {
            scrollOnFirstResponseOnce();
          }
        } else if (event === StreamEventEnum.INTERACTION_REQUEST) {
          const normalizedInteractionRequest = normalizeInteractionRequestPayload({
            ...(data || {}),
            interactionType: String(data?.interactionType || "").trim(),
          });
          scrollOnFirstResponseOnce();
          if (tryAutoResolveInteraction(normalizedInteractionRequest)) {
            return;
          }
          setPendingInteractionRequest(normalizedInteractionRequest);
        } else if (event === StreamEventEnum.CONNECTOR_STATUS) {
          const { connectorType, connectorName, status } =
            resolveConnectorStatusPayload(data);
          if (connectorTypeSet.has(connectorType) && connectorName) {
            upsertConnectedConnectorInPanelState(activeSession.value, {
              connectorType,
              connectorName,
              status,
            });
            refreshSessionConnectorsAsync(activeSession.value?.id || "");
          }
        } else if (event === StreamEventEnum.DONE) {
          clearPendingInteraction();
          finalDoneEventData = data || {};
          botMsg.dialogProcessId = data.dialogProcessId || botMsg.dialogProcessId || "";
          if (!requestedTextStreaming && Array.isArray(data?.executionLogs)) {
            const doneRealtimeLogs = data.executionLogs
              .map((executionLogItem) =>
                classifyRealtimeLog(normalizeExecutionLogForRealtime(executionLogItem)),
              )
              .filter(Boolean);
            if (doneRealtimeLogs.length) {
              botMsg.realtimeLogs = [...(botMsg.realtimeLogs || []), ...doneRealtimeLogs].slice(
                -10,
              );
              botMsg.executionLogTotal = Math.max(
                Number(botMsg.executionLogTotal || 0),
                doneRealtimeLogs.length,
                Number(data?.executionLogs?.length || 0),
              );
              if (!String(botMsg.dialogProcessId || "").trim()) {
                const latestDialogProcessId = [...doneRealtimeLogs]
                  .reverse()
                  .map((logItem) => String(logItem?.dialogProcessId || "").trim())
                  .find(Boolean);
                if (latestDialogProcessId) {
                  botMsg.dialogProcessId = latestDialogProcessId;
                }
              }
              scrollOnFirstResponseOnce();
            }
          }
          const returnedId = data.sessionId || activeSession.value.backendSessionId;
          if (returnedId) {
            activeSession.value.loaded = true;
            const promotionResult = promoteSessionIdentityToBackendId({
              sessionItem: activeSession.value,
              backendSessionId: returnedId,
              activeSessionId: activeSessionId.value,
            });
            activeSessionId.value = promotionResult.nextActiveSessionId;
          }
          if (Array.isArray(data.messages) && data.messages.length) {
            activeSession.value.rawMessages = data.messages.map((messageItem) =>
              makeViewMessage(messageItem),
            );
            const folded = foldMessagesForView(data.messages);
            const assistantMessagesForCurrentTurn = pickAssistantMessagesForCurrentTurn({
              foldedMessages: folded,
              dialogProcessId: botMsg.dialogProcessId || data.dialogProcessId,
            });
            const workflowAssistants = assistantMessagesForCurrentTurn.filter(
              (messageItem) => messageItem?.workflowMessage === true,
            );
            const normalAssistants = assistantMessagesForCurrentTurn.filter(
              (messageItem) => messageItem?.workflowMessage !== true,
            );
            const patchAssistants = normalAssistants.length
              ? normalAssistants
              : assistantMessagesForCurrentTurn;
            const lastAssistant = patchAssistants[patchAssistants.length - 1];
            if (lastAssistant) {
              const mergedAssistantContent = mergeAssistantContents(patchAssistants);
              const lastAssistantType = String(lastAssistant.type || "");
              if (lastAssistantType && lastAssistantType !== "tool_call") {
                botMsg.type = lastAssistantType;
              }
              botMsg.tool_calls = Array.isArray(lastAssistant.tool_calls)
                ? lastAssistant.tool_calls
                : [];
              botMsg.dialogProcessId = lastAssistant.dialogProcessId || botMsg.dialogProcessId;
              botMsg.content = String(mergedAssistantContent || botMsg.content || "");
              botMsg.modelAlias = String(lastAssistant.modelAlias || "").trim();
              botMsg.modelName = String(lastAssistant.modelName || "").trim();
              if (Array.isArray(lastAssistant.modelRuns)) {
                botMsg.modelRuns = lastAssistant.modelRuns;
              }
              if (Array.isArray(lastAssistant.attachmentMetas)) {
                botMsg.attachmentMetas = lastAssistant.attachmentMetas;
              }
            }
            if (workflowAssistants.length && Array.isArray(activeSession.value?.messages)) {
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
          }
          scrollBottom();
        }
      });

      if (sending.value && finalDoneEventData) {
        // Safety net: if terminal channel_state is delayed/lost, avoid sticky "stop" UI.
        // Primary source of truth remains channel_state; this fallback only runs when
        // stream is already ended and UI is still in-flight.
        applyConversationState(
          {
            state: "completed",
            sessionId: String(
              finalDoneEventData?.sessionId ||
                activeSession.value?.backendSessionId ||
                activeSession.value?.id ||
                "",
            ),
            dialogProcessId: String(
              botMsg?.dialogProcessId || finalDoneEventData?.dialogProcessId || "",
            ),
            sourceEvent: "stream_finalize_fallback",
          },
          { botMessage: botMsg },
        );
      }

      if (chatWebSocketClient.isStopRequested()) {
        applyConversationState(
          {
            state: "stopped",
            sessionId: String(
              activeSession.value?.backendSessionId || activeSession.value?.id || "",
            ),
            dialogProcessId: String(botMsg?.dialogProcessId || ""),
          },
          { botMessage: botMsg },
        );
        return;
      }

      const doneSessionId = String(
        finalDoneEventData?.sessionId || activeSession.value.backendSessionId || "",
      );
      const finalExecutionLogTotal = Number(botMsg.executionLogTotal || 0);
      const finalDialogProcessId = String(
        botMsg.dialogProcessId || finalDoneEventData?.dialogProcessId || "",
      ).trim();
      if (doneSessionId) {
        try {
          const detail = await fetchSessionDetail(doneSessionId);
          const shouldPreserveCurrentMessages =
            String(doneSessionId || "") ===
              String(activeSession.value?.backendSessionId || "") &&
            String(activeSession.value?.id || "") === String(activeSessionId.value || "");
          applySessionDetail(detail, {
            preserveCurrentMessages: shouldPreserveCurrentMessages,
          });
          if (finalExecutionLogTotal > 0 && finalDialogProcessId) {
            const patchExecutionTotal = (messages = []) => {
              for (const messageItem of Array.isArray(messages) ? messages : []) {
                if (String(messageItem?.role || "").trim() !== RoleEnum.ASSISTANT) continue;
                if (
                  String(messageItem?.dialogProcessId || "").trim() !==
                  finalDialogProcessId
                ) {
                  continue;
                }
                messageItem.executionLogTotal = Math.max(
                  Number(messageItem?.executionLogTotal || 0),
                  finalExecutionLogTotal,
                );
              }
            };
            patchExecutionTotal(activeSession.value?.messages || []);
            patchExecutionTotal(activeSession.value?.rawMessages || []);
          }
          refreshSessionConnectorsAsync(activeSession.value?.id || doneSessionId);
        } catch (loadDetailError) {
          console.warn("load session detail after done failed", loadDetailError);
        }
      }
    } catch (error) {
      if (chatWebSocketClient.isStopRequested()) {
        applyConversationState(
          {
            state: "stopped",
            sessionId: String(
              activeSession.value?.backendSessionId || activeSession.value?.id || "",
            ),
            dialogProcessId: String(botMsg?.dialogProcessId || ""),
          },
          { botMessage: botMsg },
        );
        return;
      }
      applyConversationState(
        {
          state: "error",
          sessionId: String(activeSession.value?.backendSessionId || activeSession.value?.id || ""),
          dialogProcessId: String(botMsg?.dialogProcessId || ""),
        },
        { botMessage: botMsg },
      );
      clearPendingInteraction();
      const errorMessage = error.message || translate("chat.unknownError");
      botMsg.error = errorMessage;
      if (!botMsg.content?.trim()) {
        botMsg.content = `> ${translate("chat.occurredError", { error: botMsg.error })}`;
      } else {
        botMsg.content += `\n\n> ${translate("chat.occurredError", { error: botMsg.error })}`;
      }
      notify({ type: "error", message: error.message || translate("chat.sendFailed") });
    } finally {
      chatWebSocketClient.clearStopRequested();
      if (!pendingInteractionRequest.value) {
        interactionSubmitting.value = false;
      }
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (cacheExpiredRefreshTimer) {
        clearTimeout(cacheExpiredRefreshTimer);
        cacheExpiredRefreshTimer = null;
      }
    });
  }

  return {
    send,
    stopSending,
  };
}
