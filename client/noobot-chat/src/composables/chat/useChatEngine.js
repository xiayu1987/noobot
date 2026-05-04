/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSelectedConnectors } from "../../shared/models/sessionModel";
import { RoleEnum, StreamEventEnum } from "../../shared/constants/chatConstants";
import { useLocale } from "../../shared/i18n/useLocale";
import { zhCNMessages } from "../../shared/i18n/locales/zh-CN";
import { enUSMessages } from "../../shared/i18n/locales/en-US";

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

export function useChatEngine({
  userId,
  allowUserInteraction,
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
  setPendingInteractionRequest,
  submitInteractionResponse,
  chatWebSocketClient,
  ensureConnected,
  notify = () => {},
} = {}) {
  const { translate, locale } = useLocale();
  function markPendingAssistantMessageStopped() {
    const sessionItem = activeSession.value;
    const messageList = Array.isArray(sessionItem?.messages) ? sessionItem.messages : [];
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const messageItem = messageList[messageIndex];
      if (String(messageItem?.role || "") !== RoleEnum.ASSISTANT) continue;
      if (!messageItem?.pending) continue;
      messageItem.pending = false;
      messageItem.statusLabel = translate("chat.stopped");
      if (!String(messageItem.content || "").trim()) {
        messageItem.content = translate("chat.stoppedContent");
      }
      break;
    }
  }

  function markAssistantMessageStopped(botMessage) {
    botMessage.pending = false;
    botMessage.statusLabel = translate("chat.stopped");
    clearPendingInteraction();
    interactionSubmitting.value = false;
    if (!String(botMessage.content || "").trim()) {
      botMessage.content = translate("chat.stoppedContent");
    }
  }

  function forceStopUiFinalize() {
    if (!sending.value) return;
    clearPendingInteraction();
    interactionSubmitting.value = false;
    markPendingAssistantMessageStopped();
    sending.value = false;
    chatWebSocketClient.dispose();
    scrollBottom();
  }

  function stopSending() {
    if (!sending.value) return false;
    return chatWebSocketClient.requestStop(forceStopUiFinalize);
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
    scrollBottom();

    try {
      clearUploads();
      const attachments = await serializeAttachments(filesToSend);
      let finalDoneEventData = null;

      const payload = {
        userId: userId.value,
        sessionId: activeSession.value.backendSessionId || activeSession.value.id,
        message: text || translate("chat.uploadHint"),
        attachments,
        config: {
          allowUserInteraction: allowUserInteraction?.value === false ? false : true,
          locale: String(locale.value || "").trim(),
          selectedConnectors: normalizeSelectedConnectors(
            activeSession.value?.connectorPanelState?.selectedConnectors || {},
          ),
        },
      };

      await chatWebSocketClient.stream(payload, ({ event, data }) => {
        if (event === StreamEventEnum.THINKING) {
          const item = classifyRealtimeLog(data);
          if (!item.subAgentCall && item.dialogProcessId) {
            botMsg.dialogProcessId = item.dialogProcessId;
          }
          botMsg.executionLogTotal = Number(botMsg.executionLogTotal || 0) + 1;
          botMsg.realtimeLogs = [...(botMsg.realtimeLogs || []), item].slice(-10);
        } else if (event === StreamEventEnum.DELTA) {
          const chunkText = String(data.text || "");
          botMsg.content += chunkText;
          if (chunkText) {
            scrollBottom();
          }
        } else if (event === StreamEventEnum.INTERACTION_REQUEST) {
          const interactionType = String(data?.interactionType || "").trim();
          if (interactionType === "connector_connected") {
            const interactionData =
              data?.interactionData && typeof data.interactionData === "object"
                ? data.interactionData
                : {};
            const connectedType = String(
              data?.connectorType || interactionData?.connectorType || "",
            ).trim();
            const connectedName = String(
              data?.connectorName || interactionData?.connectorName || "",
            ).trim();
            const connectedStatus = String(interactionData?.status || "connected").trim();
            if (connectorTypeSet.has(connectedType) && connectedName) {
              upsertConnectedConnectorInPanelState(activeSession.value, {
                connectorType: connectedType,
                connectorName: connectedName,
                status: connectedStatus,
              });
              refreshSessionConnectorsAsync(activeSession.value.id);
            }
            try {
              submitInteractionResponse(
                {
                  confirmed: true,
                  response: "connector_connected_ack",
                },
                {
                  requestId: String(data?.requestId || ""),
                  requireEncryption: data?.requireEncryption === true,
                  sessionId: String(data?.sessionId || ""),
                },
              );
            } catch {}
            return;
          }

          setPendingInteractionRequest({
            requestId: String(data?.requestId || ""),
            content: String(data?.content || ""),
            fields: Array.isArray(data?.fields) ? data.fields : [],
            dialogProcessId: String(data?.dialogProcessId || ""),
            requireEncryption: data?.requireEncryption === true,
            sessionId: String(data?.sessionId || ""),
            toolName: String(data?.toolName || ""),
            needConnectionInfo: data?.needConnectionInfo === true,
            connectorName: String(data?.connectorName || ""),
            connectorType: String(data?.connectorType || ""),
            interactionType,
            interactionData:
              data?.interactionData && typeof data.interactionData === "object"
                ? data.interactionData
                : {},
          });
        } else if (event === StreamEventEnum.DONE) {
          clearPendingInteraction();
          finalDoneEventData = data || {};
          botMsg.pending = false;
          botMsg.statusLabel = translate("chat.generated");
          botMsg.dialogProcessId = data.dialogProcessId || botMsg.dialogProcessId || "";
          const returnedId = data.sessionId || activeSession.value.backendSessionId;
          if (activeSession.value.isLocal && returnedId) {
            activeSession.value.backendSessionId = returnedId;
            activeSession.value.isLocal = false;
            activeSession.value.loaded = true;
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
            const lastAssistant =
              assistantMessagesForCurrentTurn[assistantMessagesForCurrentTurn.length - 1];
            if (lastAssistant) {
              const mergedAssistantContent = mergeAssistantContents(
                assistantMessagesForCurrentTurn,
              );
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
          }
          scrollBottom();
        } else if (event === StreamEventEnum.STOPPED) {
          markAssistantMessageStopped(botMsg);
          scrollBottom();
        }
      });

      if (chatWebSocketClient.isStopRequested()) {
        markAssistantMessageStopped(botMsg);
        scrollBottom();
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
      botMsg.pending = false;
      if (chatWebSocketClient.isStopRequested()) {
        clearPendingInteraction();
        interactionSubmitting.value = false;
        botMsg.statusLabel = translate("chat.stopped");
        if (!String(botMsg.content || "").trim()) {
          botMsg.content = translate("chat.stoppedContent");
        }
        return;
      }
      clearPendingInteraction();
      botMsg.statusLabel = translate("chat.failed");
      const errorMessage = error.message || translate("chat.unknownError");
      botMsg.error = errorMessage;
      if (!botMsg.content?.trim()) {
        botMsg.content = `> ${translate("chat.occurredError", { error: botMsg.error })}`;
      } else {
        botMsg.content += `\n\n> ${translate("chat.occurredError", { error: botMsg.error })}`;
      }
      notify({ type: "error", message: error.message || translate("chat.sendFailed") });
    } finally {
      sending.value = false;
      chatWebSocketClient.clearStopRequested();
      if (!pendingInteractionRequest.value) {
        interactionSubmitting.value = false;
      }
    }
  }

  return {
    send,
    stopSending,
  };
}
