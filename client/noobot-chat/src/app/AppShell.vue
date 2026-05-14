<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, watch, computed, nextTick } from "vue";
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
import { useMarkdownRenderer } from "../composables/infra/useMarkdownRenderer";
import { useReconnect } from "../composables/infra/useReconnect";
import { usePanelState } from "../composables/infra/usePanelState";

// --- Markdown rendering (module-level singleton) ---
const { renderMarkdown } = useMarkdownRenderer();

// --- UI feedback & locale ---
const { notify: notifyUi, confirmDeleteSession } = useUiFeedback();
const { translate } = useLocale();

// --- Panel state (viewport, sidebar, drawers) ---
const {
  isMobile,
  sidebarCollapsed,
  mobileSidebarOpen,
  workspaceVisible,
  userSettingsVisible,
  configParamsVisible,
  drawerSize,
  toggleSidebar,
  closeMobileSidebar,
  openWorkspace: openWorkspaceRaw,
  openUserSettings: openUserSettingsRaw,
  openConfigParams: openConfigParamsRaw,
} = usePanelState();

// --- LocalStorage-backed refs ---
const userId = ref(localStorage.getItem("noobot_user_id") || "user-001");
const allowUserInteraction = ref(
  localStorage.getItem("noobot_allow_user_interaction") !== "false",
);
const forceTool = ref(localStorage.getItem("noobot_force_tool") === "true");
const botScenario = ref(
  String(localStorage.getItem("noobot_bot_scenario") || "").trim(),
);
const composerRef = ref();
const messageListPanelRef = ref();

// --- API connection ---
const {
  connectCode,
  apiKey,
  apiRole,
  scenarioConfig,
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
    await fetchSessions();
    chatWebSocketClient.connect();
    reconnectActiveSession({ force: true });
  },
});

// --- Bot scenario ---
const availableBotScenarios = computed(() => {
  const definitions =
    scenarioConfig?.value?.definitions &&
    typeof scenarioConfig.value.definitions === "object"
      ? scenarioConfig.value.definitions
      : {};
  const scenarioKeys = Object.keys(definitions)
    .map((scenarioKey) => String(scenarioKey || "").trim())
    .filter(Boolean);
  if (!scenarioKeys.length) return [];
  return scenarioKeys.map((scenarioKey) => ({
    key: scenarioKey,
    label: String(definitions?.[scenarioKey]?.name || "").trim(),
    description: String(definitions?.[scenarioKey]?.description || "").trim(),
  }));
});

function syncBotScenarioWithConfig() {
  const configuredDefaultScenario = String(
    scenarioConfig?.value?.default || "",
  ).trim();
  const currentScenario = String(botScenario.value || "").trim();
  const savedScenario = String(localStorage.getItem("noobot_bot_scenario") || "").trim();
  const availableScenarioKeySet = new Set(
    availableBotScenarios.value
      .map((scenarioItem) => String(scenarioItem?.key || "").trim())
      .filter(Boolean),
  );

  if (!availableScenarioKeySet.size) {
    botScenario.value =
      currentScenario || savedScenario || configuredDefaultScenario || "";
    return;
  }

  if (savedScenario && availableScenarioKeySet.has(savedScenario)) {
    botScenario.value = savedScenario;
    return;
  }

  if (currentScenario && availableScenarioKeySet.has(currentScenario)) {
    return;
  }

  const nextScenario =
    (configuredDefaultScenario && availableScenarioKeySet.has(configuredDefaultScenario)
      ? configuredDefaultScenario
      : "") || "";
  botScenario.value = nextScenario;
  localStorage.setItem("noobot_bot_scenario", nextScenario);
}

// --- Chat session ---
const TOOL_LOG_TYPES = new Set(["tool_call", "tool_result"]);

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
  return {
    event: eventName || "system",
    type: type || (isTool ? "tool_call" : "system"),
    text: text || (eventName ? `[${eventName}]` : ""),
    dialogProcessId: String(data.dialogProcessId || ""),
    ts: String(data.ts || new Date().toISOString()),
    category: isTool ? "tool" : "system",
    subAgentCall: Boolean(data.subAgentCall),
    subAgentSessionId: String(data.subAgentSessionId || ""),
    subAgentLabel: String(data.subAgentLabel || ""),
    subAgentTask: String(data.subAgentTask || ""),
  };
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
  appendUploads,
  clearUploads,
  shouldRenderMessageInChat,
  closeMobileSidebarOnSelect,
  releaseAllPreviewUrls,
  initSessionsAfterMount,
  chatWebSocketClient,
  handleReconnect,
} = useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  forceTool,
  botScenario,
  connected,
  ensureConnected,
  authFetch,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  notify: notifyUi,
  clearUploadSelection: () => composerRef.value?.clearUploadSelection?.(),
});

// --- Reconnect ---
function hasActiveSessionForReconnect() {
  return Boolean(
    String(activeSession.value?.backendSessionId || "").trim() ||
      String(activeSession.value?.id || "").trim() ||
      String(activeSessionId.value || "").trim(),
  );
}

const { reconnectActiveSession } = useReconnect({
  connected,
  hasActiveSession: hasActiveSessionForReconnect,
  handleReconnect,
});

// --- Session handlers ---
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
      notifyUi({ type: "success", message: translate("common.deleteSessionSuccess") });
    }
  } catch (error) {
    notifyUi({ type: "error", message: error.message || translate("common.deleteSessionFailed") });
  }
}

// --- Panel open handlers (with guard logic) ---
function openWorkspace() {
  if (!ensureConnected()) return;
  if (!userId.value?.trim()) {
    notifyUi({ type: "warning", message: translate("common.userIdRequired") });
    return;
  }
  openWorkspaceRaw();
}

async function openUserSettings() {
  if (!ensureConnected()) return;
  if (!isSuperAdmin.value) {
    const currentRole = String(apiRole.value || "user").trim() || "user";
    notifyUi({
      type: "warning",
      message: `${translate("common.superAdminOnly")} (role=${currentRole})`,
    });
    return;
  }
  openUserSettingsRaw();
}

function openConfigParams() {
  if (!ensureConnected()) return;
  openConfigParamsRaw();
}

// --- Interaction handlers ---
function handleInteractionConfirm(payload = {}) {
  try {
    submitInteractionResponse(payload || {});
  } catch (error) {
    notifyUi({ type: "error", message: error.message || translate("common.interactionSubmitFailed") });
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
    notifyUi({ type: "error", message: error.message || translate("common.interactionCancelFailed") });
  }
}

// --- Lifecycle ---
async function onAppMounted() {
  const autoConnected = await tryAutoConnect();
  if (autoConnected) {
    return;
  }
  initSessionsAfterMount();
}

function onAppUnmounted() {
  releaseAllPreviewUrls();
}

onAppMounted();
onAppUnmounted();

// --- Watchers ---
watch(
  () => scenarioConfig.value,
  () => {
    syncBotScenarioWithConfig();
  },
  { deep: true, immediate: true },
);

function onAllowUserInteractionUpdate(value) {
  allowUserInteraction.value = Boolean(value);
  localStorage.setItem(
    "noobot_allow_user_interaction",
    allowUserInteraction.value ? "true" : "false",
  );
}

function onForceToolUpdate(value) {
  forceTool.value = Boolean(value);
  localStorage.setItem("noobot_force_tool", forceTool.value ? "true" : "false");
}

function onBotScenarioUpdate(value = "") {
  const nextScenario = String(value || "").trim();
  const availableScenarioKeySet = new Set(
    availableBotScenarios.value
      .map((scenarioItem) => String(scenarioItem?.key || "").trim())
      .filter(Boolean),
  );
  botScenario.value =
    nextScenario && availableScenarioKeySet.has(nextScenario) ? nextScenario : "";
  localStorage.setItem("noobot_bot_scenario", botScenario.value);
}

function onUserIdUpdate(value = "") {
  userId.value = String(value || "");
}

function onConnectCodeUpdate(value = "") {
  connectCode.value = String(value || "");
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
    notifyUi({ type: "error", message: error.message || translate("common.updateConnectorFailed") });
  }
}

const drawerPanels = computed(() => [
  {
    key: "workspace",
    model: workspaceVisible,
    title: translate("common.workspace"),
    component: WorkspacePanel,
    props: {
      userId: userId.value,
      apiKey: apiKey.value,
      connected: connected.value,
      active: workspaceVisible.value,
      isSuperAdmin: isSuperAdmin.value,
    },
    onWorkspaceReset: handleWorkspaceReset,
  },
  {
    key: "user-settings",
    model: userSettingsVisible,
    title: translate("common.userSettings"),
    component: UserSettingsPanel,
    props: {
      apiKey: apiKey.value,
      connected: connected.value,
      active: userSettingsVisible.value,
    },
  },
  {
    key: "config-params",
    model: configParamsVisible,
    title: translate("common.configParams"),
    component: ConfigParamsPanel,
    props: {
      userId: userId.value,
      isSuperAdmin: isSuperAdmin.value,
      apiKey: apiKey.value,
      connected: connected.value,
      active: configParamsVisible.value,
    },
  },
]);
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
        :title="activeSession?.title || translate('common.session')"
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
        :force-tool="forceTool"
        :bot-scenario="botScenario"
        :scenario-options="availableBotScenarios"
        :interaction-active="Boolean(pendingInteractionRequest)"
        @upload-change="onUploadChange"
        @append-uploads="appendUploads"
        @update:allow-user-interaction="onAllowUserInteractionUpdate"
        @update:force-tool="onForceToolUpdate"
        @update:bot-scenario="onBotScenarioUpdate"
        @clear-uploads="clearUploads"
        @connector-selected="onConnectorSelected"
        @send="send"
        @stop="stopSending"
      />
      </main>
      <el-drawer
        v-for="drawer in drawerPanels"
        :key="drawer.key"
        v-model="drawer.model.value"
        :title="drawer.title"
        :size="drawerSize"
        destroy-on-close
        class="workspace-drawer"
      >
        <component
          :is="drawer.component"
          v-bind="drawer.props"
          @workspace-reset="drawer.onWorkspaceReset?.()"
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
  width: 100%;
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
  overflow: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
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

@media (max-width: 720px) {
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

  :deep(.workspace-drawer .el-drawer) {
    height: 100svh !important;
    display: flex;
    flex-direction: column;
  }

  :deep(.workspace-drawer .el-drawer__header) {
    flex: 0 0 auto;
  }

  :deep(.workspace-drawer .el-drawer__body) {
    flex: 1 1 auto;
    min-height: 0;
    padding: 0 !important;
  }

  .app-shell-root { min-height: 100svh; }

}
</style>
