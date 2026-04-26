/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { applyCompletedToolLogsToMessages } from "./sessionToolLogs";
import {
  buildAppendMessage,
  buildViewMessage,
  foldConversationMessages,
} from "./messageModel";
import {
  buildChatWebSocketUrl,
  deleteSessionApi,
  getSessionDetailApi,
  getSessionsApi,
} from "../api/chatApi";
import { encryptPayloadBySessionId } from "../utils/sessionCrypto";

export function useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  connected,
  ensureConnected,
  authFetch,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  clearUploadSelection = () => {},
}) {
  const input = ref("");
  const uploadFiles = ref([]);
  const sending = ref(false);
  const sessions = ref([]);
  const activeSessionId = ref("");
  const loadingSessions = ref(false);
  const loadingSessionDetail = ref(false);
  const activeChatSocket = ref(null);
  const stopRequested = ref(false);
  const pendingInteractionRequest = ref(null);
  const interactionSubmitting = ref(false);

  const activeSession = computed(() =>
    sessions.value.find((sessionItem) => sessionItem.id === activeSessionId.value),
  );

  function sessionTitleFromMessages(messages = [], fallback = "新会话") {
    const firstUser = messages.find(
      (messageItem) =>
        messageItem.role === "user" && (messageItem.content || "").trim(),
    );
    return firstUser ? firstUser.content.slice(0, 20) : fallback;
  }

  function generateSessionId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      (placeholder) => {
        const randomValue = Math.floor(Math.random() * 16);
        const resolvedValue =
          placeholder === "x" ? randomValue : (randomValue & 0x3) | 0x8;
        return resolvedValue.toString(16);
      },
    );
  }

  function createLocalSession() {
    const id = generateSessionId();
    const newSessionItem = {
      id,
      title: "新会话",
      isLocal: true,
      loaded: true,
      backendSessionId: id,
      currentTaskId: "",
      currentTaskStatus: "idle",
      messageCount: 0,
      lastMessage: null,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.value.unshift(newSessionItem);
    activeSessionId.value = id;
  }

  function newSession() {
    if (sending.value) {
      ElMessage.warning("发送中，暂不能新建会话");
      return;
    }
    createLocalSession();
  }

  async function deleteSession(sessionId = "") {
    const targetSessionId = String(sessionId || "").trim();
    if (!targetSessionId) return false;
    if (sending.value) {
      ElMessage.warning("发送中，暂不能删除会话");
      return false;
    }

    const index = sessions.value.findIndex(
      (sessionItem) => sessionItem.id === targetSessionId,
    );
    if (index < 0) return false;
    const targetSession = sessions.value[index];

    if (targetSession?.isLocal) {
      revokeMessagePreviewUrls(targetSession.messages || []);
      sessions.value.splice(index, 1);
      if (!sessions.value.length) {
        createLocalSession();
      } else if (activeSessionId.value === targetSessionId) {
        activeSessionId.value = sessions.value[0].id;
        await selectSession(activeSessionId.value, { force: true });
      }
      return true;
    }

    if (!ensureConnected()) return false;
    const isDeletingActive = activeSessionId.value === targetSessionId;
    const fallbackNextSessionId = isDeletingActive
      ? String(
          sessions.value[index + 1]?.id ||
            sessions.value[index - 1]?.id ||
            "",
        )
      : String(activeSessionId.value || "");
    const res = await deleteSessionApi(
      { userId: userId.value, sessionId: targetSessionId },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "删除会话失败");
    }
    await fetchSessions(fallbackNextSessionId);
    return true;
  }

  function mapSummaryToSession(item) {
    const messages = Array.isArray(item.messages) ? item.messages : [];
    const lastMessage = messages.length ? messages[messages.length - 1] : null;
    return {
      id: item.sessionId,
      title: sessionTitleFromMessages(messages, item.sessionId.slice(0, 8)),
      isLocal: false,
      loaded: false,
      backendSessionId: item.sessionId,
      currentTaskId: item.currentTaskId || "",
      currentTaskStatus: "idle",
      messageCount: messages.length || 0,
      lastMessage,
      messages: [],
      rawMessages: [],
      sessionDocs: [],
      createdAt: item.createdAt || "",
      updatedAt: item.updatedAt || "",
      caller: item.caller || "",
      depth: Number(item.depth || 0),
    };
  }

  function revokeMessagePreviewUrls(messages = []) {
    for (const messageItem of messages) {
      const attachments = messageItem.attachments || [];
      for (const attachmentItem of attachments) {
        if (attachmentItem.previewUrl)
          URL.revokeObjectURL(attachmentItem.previewUrl);
      }
    }
  }

  async function fetchSessions(preferredActiveId = "") {
    if (!ensureConnected()) return;
    loadingSessions.value = true;
    try {
      const prevActiveId = String(preferredActiveId || activeSessionId.value || "");
      const res = await getSessionsApi(
        { userId: userId.value },
        { fetcher: authFetch },
      );
      if (!res.ok) throw new Error(`获取 sessions 失败: HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "获取 sessions 失败");

      sessions.value = (data.sessions || [])
        .filter((sessionItem) => String(sessionItem?.caller || "") === "user")
        .sort(
          (leftSession, rightSession) =>
            new Date(rightSession.updatedAt || 0).getTime() -
            new Date(leftSession.updatedAt || 0).getTime(),
        )
        .map(mapSummaryToSession);

      for (const session of sessions.value) {
        revokeMessagePreviewUrls(session.messages || []);
      }

      if (!sessions.value.length) {
        createLocalSession();
        return;
      }
      const keepActive =
        prevActiveId &&
        sessions.value.some((sessionItem) => sessionItem.id === prevActiveId);
      const nextId = keepActive ? prevActiveId : sessions.value[0].id;
      await selectSession(nextId, { force: true });
    } catch (error) {
      ElMessage.error(error.message || "加载会话失败");
      if (!sessions.value.length) createLocalSession();
    } finally {
      loadingSessions.value = false;
    }
  }

  function onUploadChange(file, fileList) {
    uploadFiles.value = fileList
      .map((fileItem) => fileItem.raw)
      .filter(Boolean)
      .map((raw) => ({
        raw,
        name: raw.name,
        mimeType: raw.type || "application/octet-stream",
        size: raw.size || 0,
        previewUrl: isImageMime(raw.type || "") ? URL.createObjectURL(raw) : "",
      }));
  }

  function clearUploads() {
    for (const uploadFile of uploadFiles.value) {
      if (uploadFile.previewUrl) URL.revokeObjectURL(uploadFile.previewUrl);
    }
    uploadFiles.value = [];
    clearUploadSelection();
  }

  function appendMessage(role, content = "", attachments = []) {
    const msg = reactive(buildAppendMessage(role, content, attachments));
    activeSession.value.messages.push(msg);
    activeSession.value.rawMessages.push(msg);
    activeSession.value.messageCount = (activeSession.value.messageCount || 0) + 1;
    activeSession.value.lastMessage = msg;
    activeSession.value.updatedAt = new Date().toISOString();
    return msg;
  }

  function makeViewMessage(messageItem = {}) {
    return reactive(
      buildViewMessage(messageItem, {
        userId: userId.value,
        apiKey: apiKey.value,
        isImageMime,
      }),
    );
  }

  function foldMessagesForView(messages = []) {
    return foldConversationMessages(messages, makeViewMessage);
  }

  function applySessionDetail(detail, options = {}) {
    const preserveCurrentMessages = Boolean(options.preserveCurrentMessages);
    const sessionItem = sessions.value.find(
      (candidateSession) => candidateSession.id === detail.sessionId,
    );
    if (!sessionItem) return;
    const openThinkingDialogProcessIds = new Set(
      (sessionItem.messages || [])
        .filter(
          (messageItem) =>
            String(messageItem?.role || "") === "assistant" &&
            Array.isArray(messageItem?.thinkingOpenNames) &&
            messageItem.thinkingOpenNames.includes("thinking-panel") &&
            String(messageItem?.dialogProcessId || "").trim(),
        )
        .map((messageItem) => String(messageItem.dialogProcessId || "").trim()),
    );
    if (!preserveCurrentMessages) {
      revokeMessagePreviewUrls(sessionItem.messages || []);
    }
    sessionItem.loaded = true;
    sessionItem.isLocal = false;
    sessionItem.backendSessionId = detail.sessionId;
    const sessionDocs = Array.isArray(detail.sessions) ? detail.sessions : [];
    sessionItem.sessionDocs = sessionDocs;
    const mainSessionDoc =
      sessionDocs.find((doc) => doc.sessionId === detail.sessionId) ||
      sessionDocs[0] ||
      {};
    sessionItem.rawMessages = (mainSessionDoc.messages || []).map((messageItem) =>
      makeViewMessage(messageItem),
    );
    sessionItem.currentTaskId = mainSessionDoc.currentTaskId || "";
    sessionItem.currentTaskStatus = "idle";
    sessionItem.createdAt = mainSessionDoc.createdAt || sessionItem.createdAt;
    sessionItem.updatedAt = mainSessionDoc.updatedAt || sessionItem.updatedAt;
    if (!preserveCurrentMessages) {
      sessionItem.messages = foldMessagesForView(mainSessionDoc.messages || []);
      for (const messageItem of sessionItem.messages || []) {
        const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
        if (!dialogProcessId) continue;
        if (openThinkingDialogProcessIds.has(dialogProcessId)) {
          messageItem.thinkingOpenNames = ["thinking-panel"];
        }
      }
    }
    applyCompletedToolLogsToMessages(sessionItem.messages, sessionDocs);
    sessionItem.messageCount = sessionItem.messages.length;
    sessionItem.lastMessage = sessionItem.messages.length
      ? sessionItem.messages[sessionItem.messages.length - 1]
      : null;
    if (!preserveCurrentMessages) {
      sessionItem.title = sessionTitleFromMessages(
        sessionItem.messages,
        sessionItem.title || detail.sessionId.slice(0, 8),
      );
      scrollBottom();
    }
  }

  async function fetchSessionDetail(sessionId) {
    const res = await getSessionDetailApi(
      { userId: userId.value, sessionId },
      { fetcher: authFetch },
    );
    if (!res.ok) throw new Error(`获取 session 失败: HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok || !data.exists) throw new Error(data.error || "session 不存在");
    return data;
  }

  async function selectSession(sessionId, options = {}) {
    const { force = false } = options;
    if (!sessionId) return;
    const target = sessions.value.find(
      (sessionItem) => sessionItem.id === sessionId,
    );
    if (!target) return;
    if (!force && sessionId === activeSessionId.value) return;
    if (sending.value && activeSessionId.value && sessionId !== activeSessionId.value) {
      ElMessage.warning("消息发送中，已保持当前会话，聊天不中断");
      return;
    }
    activeSessionId.value = sessionId;
    if (target.isLocal || (target.loaded && !force)) return;

    loadingSessionDetail.value = true;
    try {
      const detail = await fetchSessionDetail(sessionId);
      applySessionDetail(detail);
    } catch (error) {
      ElMessage.error(error.message || "加载会话详情失败");
    } finally {
      loadingSessionDetail.value = false;
    }
  }

  async function streamChat(payload, onEvent) {
    await new Promise((resolve, reject) => {
      const wsUrl = buildChatWebSocketUrl({ apiKey: apiKey.value || "" });
      const ws = new WebSocket(wsUrl);
      activeChatSocket.value = ws;
      stopRequested.value = false;
      let settled = false;
      let doneReceived = false;

      const finalize = (fn) => {
        if (settled) return;
        settled = true;
        if (activeChatSocket.value === ws) {
          activeChatSocket.value = null;
        }
        fn();
      };

      ws.onopen = () => {
        ws.send(JSON.stringify(payload || {}));
      };

      ws.onmessage = (messageEvent) => {
        try {
          const parsed = JSON.parse(String(messageEvent?.data || "{}"));
          const evt = {
            event: String(parsed?.event || "message"),
            data: parsed?.data || {},
          };
          if (evt.event === "error") {
            throw new Error(evt.data?.error || "websocket stream error");
          }
          onEvent(evt);
          if (evt.event === "done") {
            doneReceived = true;
            ws.close(1000, "done");
          } else if (evt.event === "stopped") {
            doneReceived = true;
            ws.close(1000, "stopped");
          }
        } catch (error) {
          ws.close(1011, "invalid_event");
          finalize(() => reject(error));
        }
      };

      ws.onerror = () => {
        finalize(() => reject(new Error("WebSocket 连接失败")));
      };

      ws.onclose = () => {
        if (doneReceived || stopRequested.value) {
          finalize(() => resolve());
          return;
        }
        finalize(() => reject(new Error("WebSocket 连接已关闭")));
      };
    });
  }

  function stopSending() {
    if (!sending.value) return false;
    stopRequested.value = true;
    const ws = activeChatSocket.value;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "stop" }));
      return true;
    }
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, "stop_requested");
      return true;
    }
    return false;
  }

  function submitInteractionResponse(response = {}) {
    const request = pendingInteractionRequest.value;
    const ws = activeChatSocket.value;
    if (!request?.requestId || !ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("交互通道不可用");
    }
    interactionSubmitting.value = true;
    const requireEncryption = request?.requireEncryption === true;
    const sessionId = String(request?.sessionId || "").trim();
    const responsePayload =
      requireEncryption && sessionId
        ? {
            encrypted: true,
            payload: encryptPayloadBySessionId(response || {}, sessionId),
          }
        : response || {};
    ws.send(
      JSON.stringify({
        action: "interaction_response",
        requestId: request.requestId,
        response: responsePayload,
      }),
    );
    pendingInteractionRequest.value = null;
    interactionSubmitting.value = false;
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function serializeAttachments(files) {
    const out = [];
    for (const fileItem of files) {
      out.push({
        name: fileItem.name,
        mimeType: fileItem.mimeType || "application/octet-stream",
        contentBase64: await toBase64(fileItem.raw),
      });
    }
    return out;
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
    appendMessage("user", text || "[仅上传附件]", userAttachments);
    if (activeSession.value.title === "新会话" && text) {
      activeSession.value.title = text.slice(0, 20);
    }

    const botMsg = appendMessage("assistant", "");
    botMsg.pending = true;
    botMsg.statusLabel = "";
    scrollBottom();

    try {
      clearUploads();
      const attachments = await serializeAttachments(filesToSend);
      let finalDoneEventData = null;

      const payload = {
        userId: userId.value,
        sessionId: activeSession.value.backendSessionId || activeSession.value.id,
        message: text || "请先读取我上传的附件并总结关键信息。",
        attachments,
        config: {
          allowUserInteraction:
            allowUserInteraction?.value === false ? false : true,
        },
      };

      await streamChat(payload, ({ event, data }) => {
        if (event === "thinking") {
          const item = classifyRealtimeLog(data);
          if (item.dialogProcessId) botMsg.dialogProcessId = item.dialogProcessId;
          botMsg.realtimeLogs = [...(botMsg.realtimeLogs || []), item].slice(-10);
        } else if (event === "delta") {
          const chunkText = String(data.text || "");
          botMsg.content += chunkText;
          if (chunkText) {
            scrollBottom();
          }
        } else if (event === "interaction_request") {
          pendingInteractionRequest.value = {
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
          };
        } else if (event === "done") {
          pendingInteractionRequest.value = null;
          finalDoneEventData = data || {};
          botMsg.pending = false;
          botMsg.statusLabel = "生成完成";
          botMsg.dialogProcessId =
            data.dialogProcessId || botMsg.dialogProcessId || "";
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
            const lastAssistant =
              [...folded]
                .reverse()
                .find(
                  (assistantMessage) =>
                    assistantMessage.role === "assistant" &&
                    assistantMessage.dialogProcessId === botMsg.dialogProcessId,
                ) ||
              [...folded]
                .reverse()
                .find((assistantMessage) => assistantMessage.role === "assistant");
            if (lastAssistant) {
              const lastAssistantType = String(lastAssistant.type || "");
              if (lastAssistantType && lastAssistantType !== "tool_call") {
                botMsg.type = lastAssistantType;
              }
              botMsg.tool_calls = Array.isArray(lastAssistant.tool_calls)
                ? lastAssistant.tool_calls
                : [];
              botMsg.dialogProcessId =
                lastAssistant.dialogProcessId || botMsg.dialogProcessId;
              botMsg.content = String(lastAssistant.content || botMsg.content || "");
              if (Array.isArray(lastAssistant.attachments)) {
                botMsg.attachments = lastAssistant.attachments;
              }
            }
          }
          scrollBottom();
        } else if (event === "stopped") {
          botMsg.pending = false;
          botMsg.statusLabel = "已停止";
          pendingInteractionRequest.value = null;
          if (!String(botMsg.content || "").trim()) {
            botMsg.content = "（已停止）";
          }
          scrollBottom();
        }
      });

      const doneSessionId = String(
        finalDoneEventData?.sessionId || activeSession.value.backendSessionId || "",
      );
      if (doneSessionId) {
        try {
          const detail = await fetchSessionDetail(doneSessionId);
          const shouldPreserveCurrentMessages =
            String(doneSessionId || "") ===
              String(activeSession.value?.backendSessionId || "") &&
            String(activeSession.value?.id || "") ===
              String(activeSessionId.value || "");
          applySessionDetail(detail, {
            preserveCurrentMessages: shouldPreserveCurrentMessages,
          });
        } catch (loadDetailError) {
          console.warn("load session detail after done failed", loadDetailError);
        }
      }
    } catch (error) {
      botMsg.pending = false;
      pendingInteractionRequest.value = null;
      if (stopRequested.value) {
        botMsg.statusLabel = "已停止";
        if (!String(botMsg.content || "").trim()) {
          botMsg.content = "（已停止）";
        }
        return;
      }
      botMsg.statusLabel = "生成失败";
      const errorMessage = error.message || "未知错误";
      botMsg.error = errorMessage;
      if (!botMsg.content?.trim()) {
        botMsg.content = `> 发生错误：${botMsg.error}`;
      } else {
        botMsg.content += `\n\n> 发生错误：${botMsg.error}`;
      }
      ElMessage.error(error.message);
    } finally {
      sending.value = false;
      stopRequested.value = false;
      interactionSubmitting.value = false;
    }
  }

  function closeMobileSidebarOnSelect(isMobileRef, mobileSidebarOpenRef) {
    if (isMobileRef.value) mobileSidebarOpenRef.value = false;
  }

  function shouldRenderMessageInChat(messageItem) {
    const messageRole = String(messageItem?.role || "");
    const messageType = String(messageItem?.type || "");
    if (
      messageRole === "tool" ||
      (messageRole === "assistant" && messageType === "tool_call")
    ) {
      return false;
    }
    return true;
  }

  function releaseAllPreviewUrls() {
    clearUploads();
    for (const sessionItem of sessions.value) {
      revokeMessagePreviewUrls(sessionItem.messages || []);
    }
  }

  function initSessionsAfterMount() {
    if (connected.value) {
      fetchSessions();
    } else {
      createLocalSession();
    }
  }

  return {
    input,
    uploadFiles,
    sending,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
    newSession,
    deleteSession,
    fetchSessions,
    selectSession,
    send,
    stopSending,
    pendingInteractionRequest,
    interactionSubmitting,
    submitInteractionResponse,
    onUploadChange,
    clearUploads,
    shouldRenderMessageInChat,
    closeMobileSidebarOnSelect,
    releaseAllPreviewUrls,
    initSessionsAfterMount,
  };
}
