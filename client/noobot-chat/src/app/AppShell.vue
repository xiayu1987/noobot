<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import MarkdownIt from "markdown-it";
import noobotLogo from "../shared/assets/noobot.svg";
import WorkspacePanel from "../modules/settings/WorkspacePanel.vue";
import UserSettingsPanel from "../modules/settings/UserSettingsPanel.vue";
import ConfigParamsPanel from "../modules/settings/ConfigParamsPanel.vue";
import UserInteractionForm from "../modules/composer/UserInteractionForm.vue";
import ChatComposer from "../modules/composer/ChatComposer.vue";
import ChatMainHeader from "./ChatMainHeader.vue";
import ChatMessageListPanel from "./ChatMessageListPanel.vue";
import SessionSidebar from "../modules/session/SessionSidebar.vue";
import { useApiConnection } from "../composables/infra/useApiConnection";
import { useChatSession } from "../composables/chat/useChatSession";
import { useUiFeedback } from "../composables/infra/useUiFeedback";
import { useLocale } from "../shared/i18n/useLocale";

const md = new MarkdownIt({ html: true, linkify: true, breaks: true });
const defaultFenceRenderer =
  md.renderer.rules.fence ||
  ((tokens, idx, options, env, self) =>
    self.renderToken(tokens, idx, options));
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx] || {};
  const info = String(token?.info || "").trim().toLowerCase();
  if (info === "mermaid") {
    const diagramCode = md.utils.escapeHtml(String(token?.content || ""));
    return `<div class="mermaid">${diagramCode}</div>`;
  }
  return defaultFenceRenderer(tokens, idx, options, env, self);
};

function looksLikeMermaidLine(rawLine = "") {
  const line = String(rawLine || "").trim();
  if (!line) return false;
  const mermaidPrefixes = [
    "graph ",
    "flowchart ",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram",
    "erDiagram",
    "journey",
    "gantt",
    "pie ",
    "mindmap",
    "timeline",
  ];
  return mermaidPrefixes.some((prefix) => line.startsWith(prefix));
}

function normalizeMermaidMarkdown(inputText = "") {
  const sourceText = String(inputText || "");
  if (!sourceText.trim()) return sourceText;
  const lines = sourceText.split(/\r?\n/);
  const outputLines = [];
  let inCodeFence = false;

  for (const currentLine of lines) {
    const trimmedLine = String(currentLine || "").trim();
    if (trimmedLine.startsWith("```")) {
      inCodeFence = !inCodeFence;
      outputLines.push(currentLine);
      continue;
    }
    if (!inCodeFence && looksLikeMermaidLine(currentLine)) {
      outputLines.push("```mermaid");
      outputLines.push(currentLine);
      outputLines.push("```");
      continue;
    }
    outputLines.push(currentLine);
  }
  return outputLines.join("\n");
}

const userId = ref(localStorage.getItem("noobot_user_id") || "user-001");
const allowUserInteraction = ref(
  localStorage.getItem("noobot_allow_user_interaction") !== "false",
);
const composerRef = ref();
const messageListPanelRef = ref();
const isMobile = ref(false);
const sidebarCollapsed = ref(false);
const mobileSidebarOpen = ref(false);
const workspaceVisible = ref(false);
const userSettingsVisible = ref(false);
const configParamsVisible = ref(false);
const { notify: notifyUi, confirmDeleteSession } = useUiFeedback();
const { t } = useLocale();

let fetchSessionsAfterConnect = async () => {};
const {
  connectCode,
  apiKey,
  isSuperAdmin,
  connecting,
  connected,
  ensureConnected,
  authFetch,
  connectBackend,
  tryAutoConnect,
} = useApiConnection({
  userId,
  notify: notifyUi,
  onConnected: async () => {
    await fetchSessionsAfterConnect();
  },
});

const TOOL_LOG_TYPES = new Set(["tool_call", "tool_result"]);

function onUserIdUpdate(value = "") {
  userId.value = String(value || "");
}

function onConnectCodeUpdate(value = "") {
  connectCode.value = String(value || "");
}

function isImageMime(type = "") {
  return type.startsWith("image/");
}

function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classifyRealtimeLog(data = {}) {
  const eventName = String(data.event || "").trim();
  const text = String(data.text || "").trim();
  const category = String(data.category || "").trim();
  const type = String(data.type || "").trim();
  const isTool =
    category === "tool" ||
    TOOL_LOG_TYPES.has(type) ||
    TOOL_LOG_TYPES.has(eventName) ||
    eventName.startsWith("tool_") ||
    text.startsWith("[tool]") ||
    text.includes('"tool_call_id"');
  let displayText = text || (eventName ? `[${eventName}]` : "");
  return {
    event: eventName || "system",
    type: type || (isTool ? "tool_call" : "system"),
    text: displayText,
    dialogProcessId: String(data.dialogProcessId || ""),
    ts: String(data.ts || new Date().toISOString()),
    category: isTool ? "tool" : "system",
    subAgentCall: Boolean(data.subAgentCall),
    subAgentSessionId: String(data.subAgentSessionId || ""),
    subAgentLabel: String(data.subAgentLabel || ""),
    subAgentTask: String(data.subAgentTask || ""),
  };
}

function renderMarkdown(text) {
  return md.render(normalizeMermaidMarkdown(text || ""));
}

function updateViewportState() {
  isMobile.value = window.innerWidth <= 768;
  if (!isMobile.value) {
    mobileSidebarOpen.value = false;
  }
}

function toggleSidebar() {
  if (isMobile.value) {
    mobileSidebarOpen.value = !mobileSidebarOpen.value;
    return;
  }
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function closeMobileSidebar() {
  if (isMobile.value) mobileSidebarOpen.value = false;
}

function openWorkspace() {
  if (!ensureConnected()) return;
  if (!userId.value?.trim()) {
    notifyUi({ type: "warning", message: t("common.userIdRequired") });
    return;
  }
  workspaceVisible.value = true;
}

function openUserSettings() {
  if (!ensureConnected()) return;
  if (!isSuperAdmin.value) {
    notifyUi({ type: "warning", message: t("common.superAdminOnly") });
    return;
  }
  userSettingsVisible.value = true;
}

function openConfigParams() {
  if (!ensureConnected()) return;
  configParamsVisible.value = true;
}

function handleInteractionConfirm(payload = {}) {
  try {
    submitInteractionResponse(payload || {});
  } catch (error) {
    notifyUi({ type: "error", message: error.message || t("common.interactionSubmitFailed") });
  }
}

function handleInteractionCancel() {
  try {
    submitInteractionResponse({
      confirmed: false,
      cancelled: true,
      response: "cancelled",
    });
  } catch (error) {
    notifyUi({ type: "error", message: error.message || t("common.interactionCancelFailed") });
  }
}

function scrollBottom() {
  nextTick(() => {
    const messageListPanel = messageListPanelRef.value;
    if (!messageListPanel) return;
    const run = () => {
      const wrap = messageListPanel.getWrapRef?.();
      const top = Number(wrap?.scrollHeight || 0);
      if (typeof messageListPanel.setScrollTop === "function") {
        messageListPanel.setScrollTop(top);
        return;
      }
      wrap?.scrollTo?.({ top, behavior: "smooth" });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  });
}

const {
  input,
  uploadFiles,
  sending,
  sessions,
  activeSessionId,
  activeSession,
  loadingSessions,
  loadingSessionDetail,
  newSession,
  fetchSessions,
  selectSession,
  deleteSession,
  send,
  stopSending,
  refreshSessionConnectorsAsync,
  updateSessionSelectedConnector,
  pendingInteractionRequest,
  interactionSubmitting,
  submitInteractionResponse,
  onUploadChange,
  clearUploads,
  shouldRenderMessageInChat,
  closeMobileSidebarOnSelect,
  releaseAllPreviewUrls,
  initSessionsAfterMount,
} = useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  connected,
  ensureConnected,
  authFetch,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  notify: notifyUi,
  clearUploadSelection: () => composerRef.value?.clearUploadSelection?.(),
});

fetchSessionsAfterConnect = fetchSessions;

function handleSelectSession(sessionId, options = {}) {
  closeMobileSidebarOnSelect(isMobile, mobileSidebarOpen);
  return selectSession(sessionId, options);
}

async function handleDeleteSession(sessionId) {
  try {
    await confirmDeleteSession();
  } catch {
    return;
  }
  try {
    const deleted = await deleteSession(sessionId);
    if (deleted) {
      notifyUi({ type: "success", message: t("common.deleteSessionSuccess") });
    }
  } catch (error) {
    notifyUi({ type: "error", message: error.message || t("common.deleteSessionFailed") });
  }
}

onMounted(async () => {
  updateViewportState();
  window.addEventListener("resize", updateViewportState);
  const autoConnected = await tryAutoConnect();
  if (autoConnected) {
    return;
  }
  initSessionsAfterMount();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateViewportState);
  releaseAllPreviewUrls();
});

function onAllowUserInteractionUpdate(value) {
  allowUserInteraction.value = Boolean(value);
  localStorage.setItem(
    "noobot_allow_user_interaction",
    allowUserInteraction.value ? "true" : "false",
  );
}

async function handleWorkspaceReset() {
  await fetchSessions();
  if (activeSessionId.value) {
    refreshSessionConnectorsAsync(activeSessionId.value);
  }
}

async function onConnectorSelected({
  connectorType = "",
  connectorName = "",
} = {}) {
  try {
    await updateSessionSelectedConnector({ connectorType, connectorName });
  } catch (error) {
    notifyUi({ type: "error", message: error.message || t("common.updateConnectorFailed") });
  }
}

const drawerSize = computed(() => (isMobile.value ? "100%" : "72%"));

</script>

<template>
  <div class="app-shell-root">
    <div
      class="chat-page"
      :class="{
        'sidebar-collapsed': sidebarCollapsed,
        'mobile-sidebar-open': mobileSidebarOpen,
      }"
    >
    <div
      v-if="mobileSidebarOpen && isMobile"
      class="mobile-mask"
      @click="closeMobileSidebar"
    ></div>
    <SessionSidebar
      :sidebar-collapsed="sidebarCollapsed"
      :is-mobile="isMobile"
      :mobile-sidebar-open="mobileSidebarOpen"
      :user-id="userId"
      :connect-code="connectCode"
      :connecting="connecting"
      :connected="connected"
      :sending="sending"
      :loading-sessions="loadingSessions"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      @toggle-sidebar="toggleSidebar"
      @update:user-id="onUserIdUpdate"
      @update:connect-code="onConnectCodeUpdate"
      @connect="connectBackend"
      @new-session="newSession"
      @delete-session="handleDeleteSession"
      @refresh-sessions="fetchSessions"
      @select-session="handleSelectSession"
    />

    <!-- 右侧主聊天区 -->
    <main class="main-content">
      <ChatMainHeader
        :title="activeSession?.title || t('common.session')"
        :user-id="userId"
        :is-super-admin="isSuperAdmin"
        @toggle-sidebar="toggleSidebar"
        @open-workspace="openWorkspace"
        @open-user-settings="openUserSettings"
        @open-config-params="openConfigParams"
      />

      <ChatMessageListPanel
        ref="messageListPanelRef"
        :loading-session-detail="loadingSessionDetail"
        :active-session="activeSession || {}"
        :should-render-message-in-chat="shouldRenderMessageInChat"
        :user-id="userId"
        :auth-fetch="authFetch"
        :render-markdown="renderMarkdown"
        :format-time="formatTime"
        :format-file-size="formatFileSize"
        :is-image-mime="isImageMime"
        :empty-logo-src="noobotLogo"
      />

      <UserInteractionForm
        v-if="pendingInteractionRequest"
        :request="pendingInteractionRequest"
        :submitting="interactionSubmitting"
        @confirm="handleInteractionConfirm"
        @cancel="handleInteractionCancel"
      />

      <ChatComposer
        ref="composerRef"
        v-model="input"
        :upload-files="uploadFiles"
        :connector-panel-state="activeSession?.connectorPanelState || {}"
        :sending="sending"
        :can-stop="sending"
        :connected="connected"
        :allow-user-interaction="allowUserInteraction"
        :interaction-active="Boolean(pendingInteractionRequest)"
        @upload-change="onUploadChange"
        @update:allow-user-interaction="onAllowUserInteractionUpdate"
        @clear-uploads="clearUploads"
        @connector-selected="onConnectorSelected"
        @send="send"
        @stop="stopSending"
      />
    </main>
    <el-drawer
      v-model="workspaceVisible"
      :title="t('common.workspace')"
      :size="drawerSize"
      destroy-on-close
      class="workspace-drawer"
    >
      <WorkspacePanel
        :user-id="userId"
        :api-key="apiKey"
        :connected="connected"
        :active="workspaceVisible"
        :is-super-admin="isSuperAdmin"
        @workspace-reset="handleWorkspaceReset"
      />
    </el-drawer>
    <el-drawer
      v-model="userSettingsVisible"
      :title="t('common.userSettings')"
      :size="drawerSize"
      destroy-on-close
      class="workspace-drawer"
    >
      <UserSettingsPanel
        :api-key="apiKey"
        :connected="connected"
        :active="userSettingsVisible"
      />
    </el-drawer>
    <el-drawer
      v-model="configParamsVisible"
      :title="t('common.configParams')"
      :size="drawerSize"
      destroy-on-close
      class="workspace-drawer"
    >
      <ConfigParamsPanel
        :user-id="userId"
        :is-super-admin="isSuperAdmin"
        :api-key="apiKey"
        :connected="connected"
        :active="configParamsVisible"
      />
    </el-drawer>
    </div>
  </div>
</template>

<style scoped>
.app-shell-root {
  height: 100dvh;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-page {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100vw;
  background-color: var(--noobot-surface-sidebar);
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
    Arial, sans-serif;
  overflow: hidden;
  color: var(--noobot-text-main);
  position: relative;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--noobot-panel-bg);
  min-width: 0;
}

:deep(.workspace-drawer .el-drawer) {
  background: var(--noobot-panel-bg);
}

:deep(.workspace-drawer .el-drawer__header) {
  margin-bottom: 0;
  padding: 14px 16px;
  border-bottom: 1px solid var(--noobot-divider);
  background: var(--noobot-panel-head-bg);
  backdrop-filter: blur(10px);
  color: var(--noobot-text-strong);
}

:deep(.workspace-drawer .el-drawer__body) {
  background: var(--noobot-panel-bg);
  padding: 8px;
  box-sizing: border-box;
  overflow: hidden;
}

:deep(.workspace-drawer .el-tree) {
  --el-tree-node-hover-bg-color: var(--noobot-surface-item-hover);
  --el-tree-text-color: var(--noobot-text-main);
  --el-tree-expand-icon-color: var(--noobot-text-secondary);
  background: transparent;
}

.mobile-mask {
  display: none;
}

@media (max-width: 768px) {
  .mobile-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--noobot-mask-bg);
    z-index: 18;
  }

  :deep(.workspace-drawer) {
    width: 100% !important;
  }

  .app-shell-root { min-height: 100dvh; }

}
</style>
