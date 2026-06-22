<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import noobotLogo from "../shared/assets/noobot.svg";
import AppShellDrawers from "./AppShellDrawers.vue";
import AppShellLayout from "./AppShellLayout.vue";
import { buildAppShellDrawerPanels } from "./state/drawerPanelsState";
import ThinkingPanel from "../shared/message/ThinkingPanel.vue";
import {
  ConfigParamsPanel,
  UserSettingsPanel,
  WorkspacePanel,
} from "./entrypoints";
import { useApiConnection } from "../composables/infra/useApiConnection";
import { useChatSession } from "../composables/chat/useChatSession";
import { useUiFeedback } from "../composables/infra/useUiFeedback";
import { useLocale } from "../shared/i18n/useLocale";
import { useMarkdownRenderer } from "../composables/infra/useMarkdownRenderer";
import { useReconnect } from "../composables/infra/useReconnect";
import { usePanelState } from "../composables/infra/usePanelState";
import { frontendConfig } from "../shared/config/frontendConfig";
import { PSEUDO_PANEL, useAppShellPseudoRoute } from "./useAppShellPseudoRoute";
import { useAppShellPreferences } from "./useAppShellPreferences";
import { useThinkingDetailsPanel } from "./useThinkingDetailsPanel";
import { useMobileChatNavigatorTrigger } from "./useMobileChatNavigatorTrigger";
import { useOpenVSCodeAction } from "./useOpenVSCodeAction";
import { createChatMessageScrollSync } from "./chatMessageScrollSync";
import {
  closeChatMessageNavigator,
  openChatMessageNavigator as openChatMessageNavigatorState,
  selectChatMessageNavigatorItem,
} from "./state/chatMessageNavigatorState";
import { buildChatMessageNavItems } from "./state/chatMessageNavItemsState";
import {
  classifyRealtimeLog,
  formatFileSize,
  formatTime,
  hasActiveSessionForReconnect as hasActiveSessionForReconnectState,
  isImageMime,
} from "./state/sessionMessageState";
import {
  submitInteractionCancel,
  submitInteractionConfirm,
  updateDrawerModelVisibility,
} from "./appShellEventHandlers";

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
  openMobileSidebar,
  closeAllDrawers,
  openWorkspace: openWorkspaceRaw,
  openUserSettings: openUserSettingsRaw,
  openConfigParams: openConfigParamsRaw,
} = usePanelState();

const layoutRef = ref();
const composerRef = computed(() => layoutRef.value?.composerRef || null);
const messageListPanelRef = computed(() => layoutRef.value?.messageListPanelRef || null);
const composerMorePanelVisible = ref(false);
const chatNavigatorVisible = ref(true);
const mobileChatNavigatorVisible = ref(false);
const currentMessageAnchorId = ref("");

const {
  userId,
  allowUserInteraction,
  forceTool,
  streamOutput,
  botScenario,
  selectedModel,
  pluginModelConfig,
  selectedPlugins,
  availableBotScenarios,
  availableModelOptions,
  availablePlugins,
  bindScenarioConfig,
  onAllowUserInteractionUpdate,
  onForceToolUpdate,
  onStreamOutputUpdate,
  onBotScenarioUpdate,
  onSelectedModelUpdate,
  onPluginModelConfigUpdate,
  onSelectedPluginsUpdate,
  onUserIdUpdate,
} = useAppShellPreferences();

// --- API connection ---
const {
  connectCode,
  apiKey,
  apiRole,
  scenarioConfig,
  isSuperAdmin,
  canUseIDE,
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
    const route = parsePseudoRouteFromLocation();
    await fetchSessions(route.sessionId || "", { scrollToBottom: false });
    await applyPseudoRoute(route);
    chatWebSocketClient.connect();
    reconnectActiveSession({ force: true });
  },
});
bindScenarioConfig(scenarioConfig);

const chatMessageNavItems = computed(() => buildChatMessageNavItems({
  messages: activeSession.value?.messages || [],
  shouldRenderMessageInChat,
  getMessageAnchorId: messageListPanelRef.value?.getMessageAnchorId,
  translateSession: () => translate("common.session"),
}));

function handleSelectChatMessageNavItem(item = {}) {
  selectChatMessageNavigatorItem({
    item,
    currentMessageAnchorId,
    messageListPanelRef,
    isMobile,
    mobileChatNavigatorVisible,
    activeSessionId,
    pushPseudoRoute,
  });
}

function locateLastChatMessageNavItem() {
  nextTick(() => {
    const items = Array.isArray(chatMessageNavItems.value) ? chatMessageNavItems.value : [];
    const lastItem = items[items.length - 1] || null;
    if (!String(lastItem?.id || "").trim()) return;
    selectChatMessageNavigatorItem({
      item: lastItem,
      currentMessageAnchorId,
      messageListPanelRef,
      isMobile,
      mobileChatNavigatorVisible,
      activeSessionId,
      pushPseudoRoute,
    });
  });
}

function locateSendingStartedMessage() {
  locateLastChatMessageNavItem();
}

function locateDoneMessage() {
  locateLastChatMessageNavItem();
}

function openChatMessageNavigator() {
  openChatMessageNavigatorState({
    mobileChatNavigatorVisible,
    activeSessionId,
    currentMessageAnchorId,
    chatNavigatorPanel: PSEUDO_PANEL.CHAT_NAVIGATOR,
    pushPseudoRoute,
  });
}

const {
  mobileChatNavigatorTriggerStyle,
  mobileChatNavigatorTriggerDragging,
  handleMobileChatNavigatorTriggerClick,
  handleMobileChatNavigatorTriggerPointerDown,
  handleMobileChatNavigatorTriggerPointerMove,
  handleMobileChatNavigatorTriggerPointerUp,
  releaseMobileChatNavigatorTrigger,
} = useMobileChatNavigatorTrigger({
  isMobile,
  openChatMessageNavigator,
});

function handleMobileChatNavigatorClosed() {
  closeChatMessageNavigator({
    activeSessionId,
    currentMessageAnchorId,
    replacePseudoRoute,
  });
}

const {
  bindChatMessageScrollSync,
  unbindChatMessageScrollSync,
} = createChatMessageScrollSync({
  currentMessageAnchorId,
  messageListPanelRef,
});

function scrollBottom() {
  nextTick(() => {
    const panel = messageListPanelRef.value;
    const wrapRef = panel?.getWrapRef?.();
    if (!wrapRef) return;
    const top = Number(wrapRef.scrollHeight || 0);
    if (typeof panel?.setScrollTop === "function") panel.setScrollTop(top);
    else wrapRef.scrollTop = top;
  });
}

// --- Chat session ---
const {
  input,
  uploadFiles,
  sending,
  canStop,
  sessions,
  activeSessionId,
  activeSession,
  loadingSessions,
  loadingSessionDetail,
  newSession,
  fetchSessions,
  fetchThinkingDetail,
  selectSession,
  deleteSession,
  send,
  stopSending,
  deleteMonotonicMessage,
  resendMonotonicMessage,
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
  conversationStateSnapshot,
  conversationStateTimeline,
} = useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  forceTool,
  streamOutput,
  botScenario,
  selectedModel,
  pluginModelConfig,
  selectedPlugins,
  connected,
  ensureConnected,
  authFetch,
  isImageMime,
  classifyRealtimeLog,
  scrollBottom,
  locateSendingStartedMessage,
  locateDoneMessage,
  notify: notifyUi,
  clearUploadSelection: () => composerRef.value?.clearUploadSelection?.(),
});

const showConversationStateDebugPanel = computed(
  () => frontendConfig.debug.showConversationStatePanel,
);

// --- Reconnect ---
function hasActiveSessionForReconnect() {
  return hasActiveSessionForReconnectState({
    activeSession: activeSession.value,
    activeSessionId: activeSessionId.value,
  });
}

const { reconnectActiveSession } = useReconnect({
  connected,
  hasActiveSession: hasActiveSessionForReconnect,
  handleReconnect,
});

const { openOpenVSCode } = useOpenVSCodeAction({
  userId,
  isMobile,
  canUseIDE,
  isSuperAdmin,
  ensureConnected,
  authFetch,
  notify: notifyUi,
  translate,
});

function closeComposerMorePanel() {
  composerMorePanelVisible.value = false;
}

const {
  thinkingDetailsVisible,
  thinkingDetailsMessageItem,
  thinkingDetailsAllMessages,
  closeThinkingDetailsPanel,
  getThinkingDetailsTitle,
  openThinkingDetailsPanel,
} = useThinkingDetailsPanel({
  activeSession,
  activeSessionId,
  fetchThinkingDetail,
  notify: notifyUi,
  translate,
  closeAllDrawers,
  closeMobileSidebar,
  closeComposerMorePanel,
  pushPseudoRoute: (route) => pushPseudoRoute(route),
  thinkingDetailsPanel: PSEUDO_PANEL.THINKING_DETAILS,
});

const {
  parsePseudoRouteFromLocation,
  applyPseudoRoute,
  pushPseudoRoute,
  replacePseudoRoute,
  addPseudoRoutePopStateListener,
  removePseudoRoutePopStateListener,
  closeAllPseudoPanels,
  handleSelectSession,
  pushPanelPseudoRoute,
  pushPanelVisibilityPseudoRoute,
  pushClosePseudoPanelRoute,
} = useAppShellPseudoRoute({
  activeSessionId,
  activeSession,
  currentMessageAnchorId,
  messageListPanelRef,
  workspaceVisible,
  userSettingsVisible,
  configParamsVisible,
  mobileSidebarOpen,
  isMobile,
  composerMorePanelVisible,
  thinkingDetailsVisible,
  mobileChatNavigatorVisible,
  isSuperAdmin,
  closeAllDrawers,
  closeMobileSidebar,
  openMobileSidebar,
  openWorkspaceRaw,
  openUserSettingsRaw,
  openConfigParamsRaw,
  closeComposerMorePanel,
  closeThinkingDetailsPanel,
  openThinkingDetailsPanel,
  closeMobileSidebarOnSelect,
  selectSession,
});

// --- Session handlers ---

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
  closeComposerMorePanel();
  openWorkspaceRaw();
  pushPanelPseudoRoute(activeSessionId.value, PSEUDO_PANEL.WORKSPACE);
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
  closeComposerMorePanel();
  openUserSettingsRaw();
  pushPanelPseudoRoute(activeSessionId.value, PSEUDO_PANEL.USER_SETTINGS);
}

function openConfigParams() {
  if (!ensureConnected()) return;
  closeComposerMorePanel();
  openConfigParamsRaw();
  pushPanelPseudoRoute(activeSessionId.value, PSEUDO_PANEL.CONFIG_PARAMS);
}

function handleToggleSidebar() {
  toggleSidebar();
  if (isMobile.value) {
    if (mobileSidebarOpen.value) closeComposerMorePanel();
    pushPanelVisibilityPseudoRoute({
      sessionId: activeSessionId.value,
      visible: mobileSidebarOpen.value,
      panel: PSEUDO_PANEL.SIDEBAR,
    });
  }
}

function handleCloseMobileSidebar() {
  closeMobileSidebar();
  pushClosePseudoPanelRoute();
}

function handleComposerMorePanelVisibleUpdate(value) {
  const nextVisible = Boolean(value);
  if (composerMorePanelVisible.value === nextVisible) return;
  if (nextVisible) {
    closeAllDrawers();
    closeMobileSidebar();
  }
  composerMorePanelVisible.value = nextVisible;
  pushPanelVisibilityPseudoRoute({
    sessionId: activeSessionId.value,
    visible: nextVisible,
    panel: PSEUDO_PANEL.COMPOSER,
  });
}

function handleDrawerModelUpdate(drawer = {}, value = false) {
  const { closed } = updateDrawerModelVisibility({ drawer, value });
  if (closed) pushClosePseudoPanelRoute();
}

// --- Interaction handlers ---
function handleInteractionConfirm(payload = {}) {
  submitInteractionConfirm({
    payload,
    submitInteractionResponse,
    notify: notifyUi,
    translate,
  });
}

function handleInteractionCancel() {
  submitInteractionCancel({
    submitInteractionResponse,
    notify: notifyUi,
    translate,
  });
}

async function onAppMounted() {
  addPseudoRoutePopStateListener();
  const autoConnected = await tryAutoConnect();
  if (autoConnected) {
    replacePseudoRoute();
    return;
  }
  initSessionsAfterMount({ scrollToBottom: false });
  replacePseudoRoute();
}

function onAppUnmounted() {
  removePseudoRoutePopStateListener();
  unbindChatMessageScrollSync();
  releaseMobileChatNavigatorTrigger();
  releaseAllPreviewUrls();
}

onMounted(onAppMounted);
onBeforeUnmount(onAppUnmounted);

// --- Watchers ---
watch(
  chatMessageNavItems,
  () => {
    nextTick(bindChatMessageScrollSync);
  },
  { flush: "post", immediate: true },
);

watch(
  () => activeSessionId.value,
  () => {
    currentMessageAnchorId.value = "";
    nextTick(bindChatMessageScrollSync);
  },
);

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

const drawerPanels = computed(() =>
  buildAppShellDrawerPanels({
    translate,
    workspaceVisible,
    userSettingsVisible,
    thinkingDetailsVisible,
    configParamsVisible,
    WorkspacePanel,
    UserSettingsPanel,
    ThinkingPanel,
    ConfigParamsPanel,
    userId: userId.value,
    apiKey: apiKey.value,
    connected: connected.value,
    isSuperAdmin: isSuperAdmin.value,
    thinkingDetailsMessageItem: thinkingDetailsMessageItem.value || {},
    thinkingDetailsAllMessages: thinkingDetailsAllMessages.value,
    getThinkingDetailsTitle,
    handleWorkspaceReset,
  })
);
</script>

<template>
  <div class="app-shell-root">
    <AppShellLayout
      ref="layoutRef"
      :sidebar-collapsed="sidebarCollapsed"
      :mobile-sidebar-open="mobileSidebarOpen"
      :is-mobile="isMobile"
      :user-id="userId"
      :connect-code="connectCode"
      :connecting="connecting"
      :connected="connected"
      :sending="sending"
      :loading-sessions="loadingSessions"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :active-session="activeSession || {}"
      :title="activeSession?.title || translate('common.session')"
      :is-super-admin="isSuperAdmin"
      :can-use-ide="canUseIDE"
      :loading-session-detail="loadingSessionDetail"
      :should-render-message-in-chat="shouldRenderMessageInChat"
      :auth-fetch="authFetch"
      :render-markdown="renderMarkdown"
      :format-time="formatTime"
      :format-file-size="formatFileSize"
      :is-image-mime="isImageMime"
      :empty-logo-src="noobotLogo"
      :delete-monotonic-message="deleteMonotonicMessage"
      :resend-monotonic-message="resendMonotonicMessage"
      :chat-message-nav-items="chatMessageNavItems"
      :chat-navigator-visible="chatNavigatorVisible"
      :current-message-anchor-id="currentMessageAnchorId"
      :mobile-chat-navigator-trigger-dragging="mobileChatNavigatorTriggerDragging"
      :mobile-chat-navigator-trigger-style="mobileChatNavigatorTriggerStyle"
      :input="input"
      :composer-more-panel-visible="composerMorePanelVisible"
      :upload-files="uploadFiles"
      :can-stop="canStop"
      :allow-user-interaction="allowUserInteraction"
      :force-tool="forceTool"
      :stream-output="streamOutput"
      :bot-scenario="botScenario"
      :selected-model="selectedModel"
      :available-model-options="availableModelOptions"
      :plugin-model-config="pluginModelConfig"
      :available-bot-scenarios="availableBotScenarios"
      :available-plugins="availablePlugins"
      :selected-plugins="selectedPlugins"
      :pending-interaction-request="pendingInteractionRequest"
      :interaction-submitting="interactionSubmitting"
      :show-conversation-state-debug-panel="showConversationStateDebugPanel"
      :conversation-state-snapshot="conversationStateSnapshot"
      :conversation-state-timeline="conversationStateTimeline"
      :translate="translate"
      @toggle-sidebar="handleToggleSidebar"
      @close-mobile-sidebar="handleCloseMobileSidebar"
      @update:user-id="onUserIdUpdate"
      @update:connect-code="onConnectCodeUpdate"
      @connect="connectBackend"
      @new-session="newSession"
      @delete-session="handleDeleteSession"
      @refresh-sessions="fetchSessions"
      @select-session="handleSelectSession"
      @open-openvscode="openOpenVSCode"
      @open-workspace="openWorkspace"
      @open-user-settings="openUserSettings"
      @open-config-params="openConfigParams"
      @open-thinking-details="openThinkingDetailsPanel"
      @toggle-chat-navigator-visible="chatNavigatorVisible = !chatNavigatorVisible"
      @select-chat-message-nav-item="handleSelectChatMessageNavItem"
      @mobile-chat-navigator-trigger-click="handleMobileChatNavigatorTriggerClick"
      @mobile-chat-navigator-trigger-pointer-down="handleMobileChatNavigatorTriggerPointerDown"
      @mobile-chat-navigator-trigger-pointer-move="handleMobileChatNavigatorTriggerPointerMove"
      @mobile-chat-navigator-trigger-pointer-up="handleMobileChatNavigatorTriggerPointerUp"
      @mobile-chat-navigator-trigger-pointer-cancel="handleMobileChatNavigatorTriggerPointerUp"
      @interaction-confirm="handleInteractionConfirm"
      @interaction-cancel="handleInteractionCancel"
      @update:input="input = $event"
      @upload-change="onUploadChange"
      @append-uploads="appendUploads"
      @update:allow-user-interaction="onAllowUserInteractionUpdate"
      @update:force-tool="onForceToolUpdate"
      @update:stream-output="onStreamOutputUpdate"
      @update:bot-scenario="onBotScenarioUpdate"
      @update:selected-model="onSelectedModelUpdate"
      @update:plugin-model-config="onPluginModelConfigUpdate"
      @update:selected-plugins="onSelectedPluginsUpdate"
      @update:more-panel-visible="handleComposerMorePanelVisibleUpdate"
      @clear-uploads="clearUploads"
      @connector-selected="onConnectorSelected"
      @send="send"
      @stop="stopSending"
    />
    <AppShellDrawers
      :drawer-panels="drawerPanels"
      :drawer-size="drawerSize"
      :is-mobile="isMobile"
      :mobile-chat-navigator-visible="mobileChatNavigatorVisible"
      :chat-message-nav-items="chatMessageNavItems"
      :current-message-anchor-id="currentMessageAnchorId"
      :translate="translate"
      @drawer-model-update="handleDrawerModelUpdate"
      @update:mobile-chat-navigator-visible="mobileChatNavigatorVisible = $event"
      @mobile-chat-navigator-closed="handleMobileChatNavigatorClosed"
      @select-chat-message-nav-item="handleSelectChatMessageNavItem"
    />
  </div>
</template>

<style scoped>
.app-shell-root {
  height: 100dvh;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  overscroll-behavior: none;
}

:global(body.noobot-mobile-chat-navigator-dragging) .app-shell-root {
  overscroll-behavior: none;
  touch-action: none;
}

:deep(.workspace-drawer .el-tree) {
  --el-tree-node-hover-bg-color: var(--noobot-surface-item-hover);
  --el-tree-text-color: var(--noobot-text-main);
  --el-tree-expand-icon-color: var(--noobot-text-secondary);
  background: transparent;
}

@media (max-width: 720px) {
  .app-shell-root { min-height: 100svh; }
}
</style>
