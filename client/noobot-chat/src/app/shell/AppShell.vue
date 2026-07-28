<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import noobotLogo from "../../shared/assets/noobot.svg";
import AppShellDrawers from "./AppShellDrawers.vue";
import AppShellLayout from "./AppShellLayout.vue";
import { buildAppShellDrawerPanels } from "../state/drawerPanelsState.js";
import ThinkingPanel from "../../modules/chat/components/thinking/ThinkingPanel.vue";
import {
  ConfigParamsPanel,
  UserSettingsPanel,
  WorkspacePanel,
} from "../entrypoints.js";
import { useApiConnection } from "../../modules/chat/composables/connectivity/useApiConnection.js";
import { useChatSession } from "../../modules/chat/composables/useChatSession.js";
import { useUiFeedback } from "../../shared/composables/useUiFeedback.js";
import { useLocale } from "../../shared/i18n/useLocale.js";
import { useMarkdownRenderer } from "../../modules/chat/composables/message/useMarkdownRenderer.js";
import { useReconnect } from "../../modules/chat/composables/connectivity/useReconnect.js";
import { usePanelState } from "../../shared/composables/usePanelState.js";
import { frontendConfig } from "../../infrastructure/config/frontendConfig.js";
import { PSEUDO_PANEL, useAppShellPseudoRoute } from "../composables/useAppShellPseudoRoute.js";
import { useAppShellPreferences } from "../composables/useAppShellPreferences.js";
import { useThinkingDetailsPanel } from "../composables/useThinkingDetailsPanel.js";
import { useOpenVSCodeAction } from "../composables/useOpenVSCodeAction.js";
import { useChatMessageNavigatorPanel } from "../composables/useChatMessageNavigatorPanel.js";
import { useAppShellPanelActions } from "../composables/useAppShellPanelActions.js";
import { useAppShellSessionActions } from "../composables/useAppShellSessionActions.js";
import { useAppShellInteractionActions } from "../composables/useAppShellInteractionActions.js";
import {
  getMessageDialogProcessId,
  getMessageSessionId,
  getMessageTurnScopeId,
} from "../../modules/chat/model/messageIdentity.js";
import { selectTurnMessageRuntime } from "../../modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { attachmentService } from "../../infrastructure/api/attachments/attachmentService.js";
import { thinkingDetailService } from "../../infrastructure/api/thinking/thinkingDetailService.js";
import { authenticatedHttpService } from "../../infrastructure/http/authenticatedHttpService.js";
import {
  classifyRealtimeLog,
  formatFileSize,
  formatTime,
  hasActiveSessionForReconnect as hasActiveSessionForReconnectState,
  isImageMime,
} from "../state/sessionMessageState.js";

const { renderMarkdown } = useMarkdownRenderer();

const { notify: notifyUi, confirmDeleteSession } = useUiFeedback();
const { translate } = useLocale();

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

async function locateDoneMessageAfterRender() {
  await nextTick();
  navigateToLastMessage();
}

function locateSendingStartedMessage() {
  chatMessageNavigatorPanel?.navigateToLastMessage?.();
}

function locateDoneMessage() {
  chatMessageNavigatorPanel?.navigateToLastMessage?.();
}

const {
  userId,
  allowUserInteraction,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  streamOutput,
  botScenario,
  selectedModel,
  memoryModel,
  pluginModelConfig,
  selectedPlugins,
  availableBotScenarios,
  availableModelOptions,
  availablePlugins,
  bindScenarioConfig,
  onAllowUserInteractionUpdate,
  onSafeConfirmUpdate,
  onSafeConfirmLevelUpdate,
  onSanitizeOutputUpdate,
  onStreamOutputUpdate,
  onBotScenarioUpdate,
  onSelectedModelUpdate,
  onMemoryModelUpdate,
  onPluginModelConfigUpdate,
  onSelectedPluginsUpdate,
  onUserIdUpdate,
} = useAppShellPreferences();

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
  refreshAuthentication,
  connectBackend,
  tryAutoConnect,
} = useApiConnection({
  userId,
  notify: notifyUi,
  onConnected: async () => {
    const route = parsePseudoRouteFromLocation();
    await fetchSessions(route.sessionId || "", { navigateToLastMessage: false });
    await applyPseudoRoute(route);
    await locateDoneMessageAfterRender();
    chatWebSocketClient.connect();
    reconnectActiveSession({ force: true });
  },
});
attachmentService.configure({ fetcher: authFetch });
thinkingDetailService.configure({ fetcher: authFetch });
authenticatedHttpService.configure({ fetcher: authFetch });
bindScenarioConfig(scenarioConfig);

function navigateToLastMessage() {
  chatMessageNavigatorPanel?.navigateToLastMessage?.();
}

function refreshSessionsFromSidebar() {
  return fetchSessions("", {
    forceCurrentSessionRerender: true,
    preserveCurrentMessages: false,
  });
}

const {
  input,
  uploadFiles,
  sending,
  canStop,
  composerActionState,
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
  renameSession,
  send,
  stopSending,
  deleteMonotonicMessage,
  resendMonotonicMessage,
  refreshSessionConnectorsAsync,
  updateSessionSelectedConnector,
  pendingInteractionRequest,
  interactionSubmitting,
  submitInteractionResponse,
  appendUploads,
  clearUploads,
  removeUpload,
  shouldRenderMessageInChat,
  closeMobileSidebarOnSelect,
  releaseAllPreviewUrls,
  initSessionsAfterMount,
  chatWebSocketClient,
  sessionLogWebSocketClient,
  handleReconnect,
  conversationStateSnapshot,
  conversationStateTimeline,
  turnRuntimeRegistry,
  workflowNodeStateRegistry,
} = useChatSession({
  userId,
  apiKey,
  allowUserInteraction,
  safeConfirm,
  safeConfirmLevel,
  sanitizeOutput,
  streamOutput,
  botScenario,
  selectedModel,
  memoryModel,
  pluginModelConfig,
  selectedPlugins,
  connected,
  ensureConnected,
  authFetch,
  refreshAuthentication,
  isImageMime,
  classifyRealtimeLog,
  navigateToLastMessage,
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
  workflowNodeStateRegistry,
  turnRuntimeRegistry,
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
  openChatMessageNavigator,
  handleMobileChatNavigatorClosed,
  unbindChatMessageScrollSync,
} = chatMessageNavigatorPanel;

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
  handleRenameSession,
  handleWorkspaceReset,
  onConnectorSelected,
} = useAppShellSessionActions({
  activeSessionId,
  confirmDeleteSession,
  deleteSession,
  renameSession,
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
  await initSessionsAfterMount({ navigateToLastMessage: false });
  replacePseudoRoute();
  await locateDoneMessageAfterRender();
}

function onAppUnmounted() {
  removePseudoRoutePopStateListener();
  unbindChatMessageScrollSync();
  releaseAllPreviewUrls();
  chatWebSocketClient?.dispose?.();
  sessionLogWebSocketClient?.dispose?.();
}

onMounted(onAppMounted);
onBeforeUnmount(onAppUnmounted);

const thinkingDetailsRuntime = computed(() => {
  const messageItem = thinkingDetailsMessageItem.value || {};
  return selectTurnMessageRuntime(turnRuntimeRegistry.value, {
    sessionId: getMessageSessionId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
    dialogProcessId: getMessageDialogProcessId(messageItem),
  });
});

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
    thinkingDetailsRuntime: thinkingDetailsRuntime.value,
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
      :composer-action-state="composerActionState"
      :loading-sessions="loadingSessions"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      :active-session="activeSession || {}"
      :title="activeSession?.title || translate('common.session')"
      :is-super-admin="isSuperAdmin"
      :can-use-ide="canUseIDE"
      :loading-session-detail="loadingSessionDetail"
      :should-render-message-in-chat="shouldRenderMessageInChat"
      :render-markdown="renderMarkdown"
      :format-time="formatTime"
      :format-file-size="formatFileSize"
      :is-image-mime="isImageMime"
      :empty-logo-src="noobotLogo"
      :delete-monotonic-message="deleteMonotonicMessage"
      :resend-monotonic-message="resendMonotonicMessage"
      :stop-execution="stopSending"
      :chat-message-nav-items="chatMessageNavItems"
      :chat-navigator-visible="chatNavigatorVisible"
      :current-message-anchor-id="currentMessageAnchorId"
      :input="input"
      :composer-more-panel-visible="composerMorePanelVisible"
      :upload-files="uploadFiles"
      :can-stop="canStop"
      :allow-user-interaction="allowUserInteraction"
      :safe-confirm="safeConfirm"
      :safe-confirm-level="safeConfirmLevel"
      :sanitize-output="sanitizeOutput"
      :stream-output="streamOutput"
      :bot-scenario="botScenario"
      :selected-model="selectedModel"
      :memory-model="memoryModel"
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
      @rename-session="handleRenameSession"
      @refresh-sessions="refreshSessionsFromSidebar"
      @select-session="handleSelectSession"
      @open-openvscode="openOpenVSCode"
      @open-workspace="openWorkspace"
      @open-user-settings="openUserSettings"
      @open-config-params="openConfigParams"
      @open-thinking-details="openThinkingDetailsPanel"
      @toggle-chat-navigator-visible="chatNavigatorVisible = !chatNavigatorVisible"
      @select-chat-message-nav-item="handleSelectChatMessageNavItem"
      @mobile-chat-navigator-trigger-click="openChatMessageNavigator"
      @interaction-confirm="handleInteractionConfirm"
      @interaction-cancel="handleInteractionCancel"
      @update:input="input = $event"
      @append-uploads="appendUploads"
      @remove-upload="removeUpload"
      @update:allow-user-interaction="onAllowUserInteractionUpdate"
      @update:safe-confirm="onSafeConfirmUpdate"
      @update:safe-confirm-level="onSafeConfirmLevelUpdate"
      @update:sanitize-output="onSanitizeOutputUpdate"
      @update:stream-output="onStreamOutputUpdate"
      @update:bot-scenario="onBotScenarioUpdate"
      @update:selected-model="onSelectedModelUpdate"
      @update:memory-model="onMemoryModelUpdate"
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
