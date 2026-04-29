<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Menu, MoreFilled } from "@element-plus/icons-vue";
import MarkdownIt from "markdown-it";
import noobotLogo from "../assets/noobot.svg";
import WorkspacePanel from "./WorkspacePanel.vue";
import UserSettingsPanel from "./UserSettingsPanel.vue";
import ConfigParamsPanel from "./ConfigParamsPanel.vue";
import UserInteractionForm from "./UserInteractionForm.vue";
import ChatComposer from "./ChatComposer.vue";
import SessionSidebar from "./SessionSidebar.vue";
import ChatMessageItem from "./ChatMessageItem.vue";
import { useApiConnection } from "../composables/useApiConnection";
import { useChatSession } from "../composables/useChatSession";
import { useUiFeedback } from "../composables/useUiFeedback";

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
const listRef = ref();
const isMobile = ref(false);
const sidebarCollapsed = ref(false);
const mobileSidebarOpen = ref(false);
const workspaceVisible = ref(false);
const userSettingsVisible = ref(false);
const configParamsVisible = ref(false);
const { notify: notifyUi, confirmDeleteSession } = useUiFeedback();

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
    notifyUi({ type: "warning", message: "请先输入 User ID" });
    return;
  }
  workspaceVisible.value = true;
}

function openUserSettings() {
  if (!ensureConnected()) return;
  if (!isSuperAdmin.value) {
    notifyUi({ type: "warning", message: "仅超级管理员可设置用户" });
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
    notifyUi({ type: "error", message: error.message || "提交交互信息失败" });
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
    notifyUi({ type: "error", message: error.message || "取消交互失败" });
  }
}

function scrollBottom() {
  nextTick(() => {
    const scrollbar = listRef.value;
    if (!scrollbar) return;
    const run = () => {
      const wrap =
        scrollbar.wrapRef ||
        scrollbar.$el?.querySelector?.(".el-scrollbar__wrap");
      const top = Number(wrap?.scrollHeight || 0);
      if (typeof scrollbar.setScrollTop === "function") {
        scrollbar.setScrollTop(top);
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
      notifyUi({ type: "success", message: "会话已删除" });
    }
  } catch (error) {
    notifyUi({ type: "error", message: error.message || "删除会话失败" });
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
    notifyUi({ type: "error", message: error.message || "更新连接器勾选失败" });
  }
}

function handleHeaderAction(command = "") {
  if (command === "workspace") return openWorkspace();
  if (command === "user-settings") return openUserSettings();
  if (command === "config-params") return openConfigParams();
}
</script>

<template>
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
      :active-connector-panel-state="activeSession?.connectorPanelState || {}"
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
      <header class="chat-header">
        <button
          class="mobile-menu-btn noobot-action-btn"
          type="button"
          @click="toggleSidebar"
          title="打开侧栏"
        >
          <el-icon><Menu /></el-icon>
        </button>
        <div class="header-info">
          <h2 class="head-title">{{ activeSession?.title || "会话" }}</h2>
          <span class="head-sub">当前用户：{{ userId }}</span>
        </div>
        <div class="header-spacer"></div>
        <div class="desktop-header-actions">
          <el-button class="workspace-btn noobot-action-btn" @click="openWorkspace"
            >工作区</el-button
          >
          <el-button
            v-if="isSuperAdmin"
            class="workspace-btn noobot-action-btn"
            @click="openUserSettings"
          >
            用户设置
          </el-button>
          <el-button
            class="workspace-btn noobot-action-btn"
            @click="openConfigParams"
          >
            参数配置
          </el-button>
        </div>
        <el-dropdown
          class="mobile-header-actions"
          trigger="click"
          @command="handleHeaderAction"
        >
          <el-button
            class="mobile-menu-btn noobot-action-btn"
            native-type="button"
            :icon="MoreFilled"
            title="更多操作"
          />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="workspace">工作区</el-dropdown-item>
              <el-dropdown-item v-if="isSuperAdmin" command="user-settings"
                >用户设置</el-dropdown-item
              >
              <el-dropdown-item command="config-params"
                >参数配置</el-dropdown-item
              >
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <div class="message-container">
        <el-scrollbar ref="listRef" class="msg-list">
          <div class="msg-list-inner">
            <el-skeleton
              v-if="loadingSessionDetail"
              :rows="6"
              animated
              class="skeleton-loading"
            />

            <div
              v-if="!activeSession?.messages?.length && !loadingSessionDetail"
              class="empty-state"
            >
              <div class="empty-icon">
                <img :src="noobotLogo" alt="Noobot Logo" class="empty-logo" />
              </div>
              <p>开始与 Noobot 的全新对话</p>
            </div>

            <template
              v-for="(messageItem, messageIndex) in activeSession?.messages ||
              []"
              :key="messageIndex"
            >
              <ChatMessageItem
                v-if="shouldRenderMessageInChat(messageItem)"
                :message-item="messageItem"
                :all-messages="activeSession?.rawMessages || activeSession?.messages || []"
                :session-docs="activeSession?.sessionDocs || []"
                :user-id="userId"
                :auth-fetch="authFetch"
                :render-markdown="renderMarkdown"
                :format-time="formatTime"
                :format-file-size="formatFileSize"
                :is-image-mime="isImageMime"
              />
            </template>
          </div>
        </el-scrollbar>
      </div>

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
      title="工作区"
      size="72%"
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
      title="用户设置"
      size="72%"
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
      title="参数配置"
      size="72%"
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
</template>

<style scoped>
.chat-page {
  display: flex;
  height: 100vh;
  width: 100vw;
  background-color: #0b0d12;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
    Arial, sans-serif;
  overflow: hidden;
  color: #e6e8ef;
  position: relative;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #0f1219;
  min-width: 0;
}

.chat-header {
  height: 64px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(16, 20, 29, 0.82);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid #1f2430;
  z-index: 10;
}

.mobile-menu-btn {
  display: none;
  width: 34px;
  height: 34px;
  border: 1px solid var(--noobot-btn-secondary-border);
  background: var(--noobot-btn-secondary-bg);
  color: var(--noobot-btn-secondary-text);
}

.header-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.header-spacer {
  flex: 1;
}

.workspace-btn {
  border: 1px solid var(--noobot-btn-secondary-border);
  background: var(--noobot-btn-secondary-bg);
  color: var(--noobot-btn-secondary-text);
  border-radius: 10px !important;
}

.desktop-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.mobile-header-actions {
  display: none;
}

.workspace-btn:hover,
.mobile-menu-btn:hover {
  background: var(--noobot-btn-secondary-bg-hover);
}

:deep(.workspace-drawer .el-drawer) {
  background: #070b14;
}

:deep(.workspace-drawer .el-drawer__header) {
  margin-bottom: 0;
  padding: 14px 16px;
  border-bottom: 1px solid #1e2739;
  background: rgba(16, 20, 29, 0.9);
  backdrop-filter: blur(10px);
  color: #e8eeff;
}

:deep(.workspace-drawer .el-drawer__body) {
  background: #070b14;
  padding-top: 12px;
  padding-bottom: 0px;
}

:deep(.workspace-drawer .el-tree) {
  --el-tree-node-hover-bg-color: #1b2640;
  --el-tree-text-color: #d7e2ff;
  --el-tree-expand-icon-color: #95a6d6;
  background: transparent;
}

.head-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #f3f6ff;
}

.head-sub {
  font-size: 12px;
  color: #9aa5c5;
  margin-top: 2px;
}

.message-container {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.msg-list {
  height: 100%;
}

.msg-list-inner {
  padding: 24px max(24px, calc(50% - 400px));
  /* 居中且最大宽度限制 */
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.skeleton-loading {
  background: #171c29;
  padding: 20px;
  border-radius: 12px;
  border: 1px solid #252c3d;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 40vh;
  color: #9ca3af;
  font-size: 15px;
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.8;
}

.empty-logo {
  width: 52px;
  height: 52px;
  display: block;
}

.mobile-mask {
  display: none;
}

@media (max-width: 768px) {
  .mobile-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.48);
    z-index: 18;
  }

  .mobile-menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .desktop-header-actions {
    display: none;
  }

  .mobile-header-actions {
    display: inline-flex;
  }

  :deep(.workspace-drawer) {
    width: 100% !important;
  }

  .chat-header {
    padding: 0 16px;
  }

  .msg-list-inner {
    padding: 16px;
  }
}

@media (max-width: 1080px) {
  .desktop-header-actions {
    display: none;
  }

  .mobile-header-actions {
    display: inline-flex;
  }
}
</style>
