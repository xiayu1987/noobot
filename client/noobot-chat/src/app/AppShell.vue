<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
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
import { useOpenVSCodeAction } from "./useOpenVSCodeAction";
import { useChatMessageNavigatorPanel } from "./useChatMessageNavigatorPanel";
import { useAppShellPanelActions } from "./useAppShellPanelActions";
import { useAppShellSessionActions } from "./useAppShellSessionActions";
import { useAppShellInteractionActions } from "./useAppShellInteractionActions";
import {
  classifyRealtimeLog,
  formatFileSize,
  formatTime,
  hasActiveSessionForReconnect as hasActiveSessionForReconnectState,
  isImageMime,
} from "./state/sessionMessageState";

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
let chatMessageNavigatorPanel = null;
let appShellPanelActions = null;

function locateSendingStartedMessage() {
  chatMessageNavigatorPanel?.locateSendingStartedMessage?.();
}

function locateDoneMessage() {
  chatMessageNavigatorPanel?.locateDoneMessage?.();
}

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
  runStateSnapshot,
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

chatMessageNavigatorPanel = useChatMessageNavigatorPanel({
  activeSession,
  activeSessionId,
  shouldRenderMessageInChat,
  messageListPanelRef,
  isMobile,
  translate,
  chatNavigatorPanel: PSEUDO_PANEL.CHAT_NAVIGATOR,
  pushPseudoRoute: (route) => pushPseudoRoute(route),
  replacePseudoRoute: (route) => replacePseudoRoute(route),
});

const {
  chatNavigatorVisible,
  mobileChatNavigatorVisible,
  currentMessageAnchorId,
  chatMessageNavItems,
  handleSelectChatMessageNavItem,
  handleMobileChatNavigatorClosed,
  mobileChatNavigatorTriggerStyle,
  mobileChatNavigatorTriggerDragging,
  handleMobileChatNavigatorTriggerClick,
  handleMobileChatNavigatorTriggerPointerDown,
  handleMobileChatNavigatorTriggerPointerMove,
  handleMobileChatNavigatorTriggerPointerUp,
  releaseMobileChatNavigatorTrigger,
  unbindChatMessageScrollSync,
} = chatMessageNavigatorPanel;

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
  appShellPanelActions?.closeComposerMorePanel?.();
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

// --- Panel, interaction & session handlers ---
appShellPanelActions = useAppShellPanelActions({
  activeSessionId,
  userId,
  apiRole,
  isSuperAdmin,
  isMobile,
  mobileSidebarOpen,
  composerMorePanelVisible,
  ensureConnected,
  notify: notifyUi,
  translate,
  closeAllDrawers,
  toggleSidebar,
  closeMobileSidebar,
  openWorkspaceRaw,
  openUserSettingsRaw,
  openConfigParamsRaw,
  pushPanelPseudoRoute,
  pushPanelVisibilityPseudoRoute,
  pushClosePseudoPanelRoute,
});

const {
  openWorkspace,
  openUserSettings,
  openConfigParams,
  handleToggleSidebar,
  handleCloseMobileSidebar,
  handleComposerMorePanelVisibleUpdate,
  handleDrawerModelUpdate,
} = appShellPanelActions;

const {
  handleInteractionConfirm,
  handleInteractionCancel,
} = useAppShellInteractionActions({
  submitInteractionResponse,
  notify: notifyUi,
  translate,
});

const {
  handleDeleteSession,
  handleWorkspaceReset,
  onConnectorSelected,
} = useAppShellSessionActions({
  activeSessionId,
  confirmDeleteSession,
  deleteSession,
  fetchSessions,
  refreshSessionConnectorsAsync,
  updateSessionSelectedConnector,
  notify: notifyUi,
  translate,
});

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

function onConnectCodeUpdate(value = "") {
  connectCode.value = String(value || "");
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
      :run-state-snapshot="runStateSnapshot"
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
