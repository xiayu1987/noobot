<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import { Tickets } from "@element-plus/icons-vue";
import noobotLogo from "../shared/assets/noobot.svg";
import ChatMainHeader from "./ChatMainHeader.vue";
import ChatMessageNavigator from "./ChatMessageNavigator.vue";
import { buildAppShellDrawerPanels } from "./state/drawerPanelsState";
import ThinkingPanel from "../shared/message/ThinkingPanel.vue";
import {
  ChatComposer,
  ChatMessageListPanel,
  ConfigParamsPanel,
  ConversationStateDebugPanel,
  SessionSidebar,
  UserInteractionForm,
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
import { PSEUDO_PANEL, usePseudoRoute } from "../composables/infra/usePseudoRoute";
import { frontendConfig } from "../shared/config/frontendConfig";
import { postOpenVSCodeServerApi } from "../services/api/chatApi";
import {
  clampMobileChatNavigatorTriggerPosition,
  loadMobileChatNavigatorTriggerPosition,
  persistMobileChatNavigatorTriggerPosition,
} from "./mobileChatNavigatorTriggerPosition";
import { createChatMessageScrollSync } from "./chatMessageScrollSync";
import {
  hasStoredSelectedPluginKeys,
  loadSelectedPluginKeys,
  normalizeAvailablePlugins,
  persistSelectedPlugins as persistSelectedPluginsState,
  syncSelectedPluginsWithConfig as syncSelectedPluginsWithConfigState,
} from "./state/pluginSelectionState";
import {
  closeChatMessageNavigator,
  openChatMessageNavigator as openChatMessageNavigatorState,
  selectChatMessageNavigatorItem,
} from "./state/chatMessageNavigatorState";
import {
  buildThinkingDetailsRoute,
  getThinkingDetailsTitle as getThinkingDetailsTitleState,
  resolveFallbackThinkingDetailsPayload as resolveFallbackThinkingDetailsPayloadState,
  resolveThinkingDetailsPanelPayload,
} from "./state/thinkingDetailsState";
import { buildChatMessageNavItems } from "./state/chatMessageNavItemsState";
import {
  buildClosePseudoPanelRoute,
  buildPanelPseudoRoute,
  buildPanelVisibilityPseudoRoute,
  buildSessionPseudoRoute,
  resolveActivePseudoPanel as resolveActivePseudoPanelState,
} from "./payload/appShellRoutePayload";
import {
  classifyRealtimeLog,
  formatFileSize,
  formatTime,
  hasActiveSessionForReconnect as hasActiveSessionForReconnectState,
  isImageMime,
} from "./state/sessionMessageState";
import {
  shouldOpenOpenVSCodeInCurrentTab as shouldOpenOpenVSCodeInCurrentTabState,
  submitInteractionCancel,
  submitInteractionConfirm,
  updateDrawerModelVisibility,
} from "./appShellEventHandlers";
import {
  hasStoredSelectedModelPreference,
  loadUiPreferences,
  normalizeAvailableBotScenarios,
  normalizeModelOptionsFromEnabledModels,
  readPluginModelConfigPreference,
  readSelectedModelPreference,
  syncBotScenarioWithConfig as syncBotScenarioWithConfigState,
  updateAllowUserInteractionPreference,
  updateBotScenarioPreference,
  updateForceToolPreference,
  updatePluginModelConfigPreference,
  updateSelectedModelPreference,
  updateStreamOutputPreference,
} from "./storage/uiPreferencesStorage";

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

// --- LocalStorage-backed refs ---
const uiPreferences = loadUiPreferences();
const userId = ref(uiPreferences.userId);
const allowUserInteraction = ref(uiPreferences.allowUserInteraction);
const forceTool = ref(uiPreferences.forceTool);
const streamOutput = ref(uiPreferences.streamOutput);
const botScenario = ref(uiPreferences.botScenario);
const selectedModel = ref(uiPreferences.selectedModel);
const pluginModelConfig = ref(uiPreferences.pluginModelConfig);
const hasStoredSelectedPlugins = ref(hasStoredSelectedPluginKeys());
const selectedPlugins = ref(loadSelectedPluginKeys());
const composerRef = ref();
const messageListPanelRef = ref();
const composerMorePanelVisible = ref(false);
const thinkingDetailsVisible = ref(false);
const thinkingDetailsMessageItem = ref(null);
const thinkingDetailsAllMessages = ref([]);
const chatNavigatorVisible = ref(true);
const mobileChatNavigatorVisible = ref(false);
const currentMessageAnchorId = ref("");
const mobileChatNavigatorTriggerPosition = ref(loadMobileChatNavigatorTriggerPosition());
const mobileChatNavigatorTriggerDragging = ref(false);
const mobileChatNavigatorTriggerMoved = ref(false);
const mobileChatNavigatorTriggerPointer = {
  id: null,
  startX: 0,
  startY: 0,
  offsetX: 0,
  offsetY: 0,
};
const MOBILE_CHAT_NAVIGATOR_DRAGGING_CLASS = "noobot-mobile-chat-navigator-dragging";

function preventMobileChatNavigatorDocumentTouch(event) {
  if (!mobileChatNavigatorTriggerDragging.value) return;
  event?.preventDefault?.();
}

function setMobileChatNavigatorDragLock(locked) {
  document?.documentElement?.classList?.toggle(MOBILE_CHAT_NAVIGATOR_DRAGGING_CLASS, Boolean(locked));
  document?.body?.classList?.toggle(MOBILE_CHAT_NAVIGATOR_DRAGGING_CLASS, Boolean(locked));
  if (locked) window?.addEventListener?.("touchmove", preventMobileChatNavigatorDocumentTouch, { passive: false });
  else window?.removeEventListener?.("touchmove", preventMobileChatNavigatorDocumentTouch, { passive: false });
}

const mobileChatNavigatorTriggerStyle = computed(() => {
  const position = mobileChatNavigatorTriggerPosition.value || {};
  if (Number.isFinite(Number(position.left)) && Number.isFinite(Number(position.top))) {
    return {
      left: `${Number(position.left)}px`,
      top: `${Number(position.top)}px`,
      right: "auto",
      bottom: "auto",
    };
  }
  return {
    right: `calc(${Number(position.right ?? 16)}px + env(safe-area-inset-right))`,
    bottom: `calc(${Number(position.bottom ?? 112)}px + env(safe-area-inset-bottom))`,
    left: "auto",
    top: "auto",
  };
});

function preventMobileChatNavigatorTriggerGesture(event) {
  event?.stopPropagation?.();
  if (event?.cancelable) event.preventDefault?.();
}

function handleMobileChatNavigatorTriggerPointerDown(event) {
  if (!isMobile.value || !event?.currentTarget) return;
  preventMobileChatNavigatorTriggerGesture(event);
  const rect = event.currentTarget.getBoundingClientRect?.();
  if (!rect) return;
  mobileChatNavigatorTriggerDragging.value = true;
  mobileChatNavigatorTriggerMoved.value = false;
  mobileChatNavigatorTriggerPointer.id = event.pointerId;
  mobileChatNavigatorTriggerPointer.startX = event.clientX;
  mobileChatNavigatorTriggerPointer.startY = event.clientY;
  mobileChatNavigatorTriggerPointer.offsetX = event.clientX - rect.left;
  mobileChatNavigatorTriggerPointer.offsetY = event.clientY - rect.top;
  setMobileChatNavigatorDragLock(true);
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function handleMobileChatNavigatorTriggerPointerMove(event) {
  if (!mobileChatNavigatorTriggerDragging.value || event.pointerId !== mobileChatNavigatorTriggerPointer.id) return;
  preventMobileChatNavigatorTriggerGesture(event);
  const deltaX = Math.abs(event.clientX - mobileChatNavigatorTriggerPointer.startX);
  const deltaY = Math.abs(event.clientY - mobileChatNavigatorTriggerPointer.startY);
  if (deltaX > 4 || deltaY > 4) mobileChatNavigatorTriggerMoved.value = true;
  mobileChatNavigatorTriggerPosition.value = clampMobileChatNavigatorTriggerPosition(
    event.clientX - mobileChatNavigatorTriggerPointer.offsetX,
    event.clientY - mobileChatNavigatorTriggerPointer.offsetY,
  );
}

function handleMobileChatNavigatorTriggerPointerUp(event) {
  if (!mobileChatNavigatorTriggerDragging.value || event.pointerId !== mobileChatNavigatorTriggerPointer.id) return;
  preventMobileChatNavigatorTriggerGesture(event);
  mobileChatNavigatorTriggerDragging.value = false;
  mobileChatNavigatorTriggerPointer.id = null;
  setMobileChatNavigatorDragLock(false);
  if (mobileChatNavigatorTriggerMoved.value) {
    persistMobileChatNavigatorTriggerPosition(mobileChatNavigatorTriggerPosition.value);
    window.setTimeout(() => {
      mobileChatNavigatorTriggerMoved.value = false;
    }, 0);
    return;
  }
  mobileChatNavigatorTriggerMoved.value = false;
  openChatMessageNavigator();
}

function handleMobileChatNavigatorTriggerClick() {
  if (mobileChatNavigatorTriggerMoved.value) return;
  openChatMessageNavigator();
}

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
    await fetchSessions(route.sessionId || "");
    await applyPseudoRoute(route);
    chatWebSocketClient.connect();
    reconnectActiveSession({ force: true });
  },
});

// --- Bot scenario ---
const availableBotScenarios = computed(() => normalizeAvailableBotScenarios(
  scenarioConfig?.value?.definitions,
));

const activeScenarioDefinition = computed(() => {
  const scenarioKey = String(botScenario.value || "").trim();
  const definitions = scenarioConfig?.value?.definitions;
  return scenarioKey && definitions && typeof definitions === "object"
    ? definitions[scenarioKey] || {}
    : {};
});

const availableModelOptions = computed(() => normalizeModelOptionsFromEnabledModels(
  Array.isArray(activeScenarioDefinition.value?.enabledModels) && activeScenarioDefinition.value.enabledModels.length
    ? activeScenarioDefinition.value.enabledModels
    : scenarioConfig?.value?.enabledModels || [],
  selectedModel.value,
  pluginModelConfig.value,
));

const availablePlugins = computed(() => {
  const definitions =
    scenarioConfig?.value?.plugins && typeof scenarioConfig.value.plugins === "object"
      ? scenarioConfig.value.plugins
      : {};
  return normalizeAvailablePlugins(definitions);
});

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

function openChatMessageNavigator() {
  openChatMessageNavigatorState({
    mobileChatNavigatorVisible,
    activeSessionId,
    currentMessageAnchorId,
    chatNavigatorPanel: PSEUDO_PANEL.CHAT_NAVIGATOR,
    pushPseudoRoute,
  });
}

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

function persistSelectedPlugins() {
  persistSelectedPluginsState({ selectedPlugins, hasStoredSelectedPlugins });
}

function syncSelectedPluginsWithConfig() {
  syncSelectedPluginsWithConfigState({
    pluginOptions: availablePlugins.value,
    selectedPlugins,
    hasStoredSelectedPlugins,
  });
}

function syncBotScenarioWithConfig() {
  syncBotScenarioWithConfigState({
    configuredDefaultScenario: scenarioConfig?.value?.default,
    availableBotScenarios: availableBotScenarios.value,
    preferenceRef: botScenario,
  });
}

// --- Chat session ---
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


function closeComposerMorePanel() {
  composerMorePanelVisible.value = false;
}

function closeAllPseudoPanels() {
  closeAllDrawers();
  closeMobileSidebar();
  closeComposerMorePanel();
  closeThinkingDetailsPanel();
  mobileChatNavigatorVisible.value = false;
}

function resolveActivePseudoPanel() {
  return resolveActivePseudoPanelState({
    workspaceVisible: workspaceVisible.value,
    userSettingsVisible: userSettingsVisible.value,
    configParamsVisible: configParamsVisible.value,
    mobileSidebarOpen: mobileSidebarOpen.value,
    isMobile: isMobile.value,
    composerMorePanelVisible: composerMorePanelVisible.value,
    thinkingDetailsVisible: thinkingDetailsVisible.value,
    mobileChatNavigatorVisible: mobileChatNavigatorVisible.value,
    panels: PSEUDO_PANEL,
  });
}

function isLoadedActiveSessionRouteTarget(sessionId = "") {
  const targetSessionId = String(sessionId || "").trim();
  const currentSession = activeSession.value || null;
  if (!targetSessionId || !currentSession?.loaded) return false;
  const currentIds = [
    activeSessionId.value,
    currentSession.id,
    currentSession.backendSessionId,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return currentIds.includes(targetSessionId);
}

async function applyPseudoRouteToUi(route = {}) {
  const targetSessionId = String(route.sessionId || "").trim();
  const targetPanel = String(route.panel || "").trim();
  const targetAnchor = String(route.anchor || "").trim();
  closeAllPseudoPanels();
  if (targetSessionId && !isLoadedActiveSessionRouteTarget(targetSessionId)) {
    await handleSelectSession(targetSessionId, {
      fromHistory: true,
      force: true,
      preserveCurrentMessages: true,
      silent: true,
    });
  }
  if (targetPanel === PSEUDO_PANEL.WORKSPACE) openWorkspaceRaw();
  if (targetPanel === PSEUDO_PANEL.USER_SETTINGS && isSuperAdmin.value) openUserSettingsRaw();
  if (targetPanel === PSEUDO_PANEL.CONFIG_PARAMS) openConfigParamsRaw();
  if (targetPanel === PSEUDO_PANEL.SIDEBAR) openMobileSidebar();
  if (targetPanel === PSEUDO_PANEL.COMPOSER) composerMorePanelVisible.value = true;
  if (targetPanel === PSEUDO_PANEL.THINKING_DETAILS) openThinkingDetailsPanel({ pushRoute: false });
  if (targetPanel === PSEUDO_PANEL.CHAT_NAVIGATOR && isMobile.value) mobileChatNavigatorVisible.value = true;
  if (targetAnchor) {
    currentMessageAnchorId.value = targetAnchor;
    await nextTick();
    messageListPanelRef.value?.scrollToMessageAnchor?.(targetAnchor);
  }
}

const {
  initialPseudoRouteApplied,
  parsePseudoRouteFromLocation,
  applyPseudoRoute,
  pushPseudoRoute,
  replacePseudoRoute,
  addPseudoRoutePopStateListener,
  removePseudoRoutePopStateListener,
} = usePseudoRoute({
  resolveCurrentSessionId: () => activeSessionId.value,
  resolveCurrentPanel: resolveActivePseudoPanel,
  resolveCurrentAnchor: () => currentMessageAnchorId.value,
  applyRoute: applyPseudoRouteToUi,
});

// --- Session handlers ---
async function handleSelectSession(sessionId, options = {}) {
  const { fromHistory = false, ...selectOptions } = options || {};
  const previousSessionId = String(activeSessionId.value || "").trim();
  closeMobileSidebarOnSelect(isMobile, mobileSidebarOpen);
  await selectSession(sessionId, selectOptions);
  const nextSessionId = String(activeSessionId.value || "").trim();
  if (
    !fromHistory &&
    !selectOptions.silent &&
    nextSessionId &&
    nextSessionId !== previousSessionId
  ) {
    pushPseudoRoute(buildSessionPseudoRoute(nextSessionId));
  }
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
  closeComposerMorePanel();
  openWorkspaceRaw();
  pushPseudoRoute(buildPanelPseudoRoute(activeSessionId.value, PSEUDO_PANEL.WORKSPACE));
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
  pushPseudoRoute(buildPanelPseudoRoute(activeSessionId.value, PSEUDO_PANEL.USER_SETTINGS));
}

async function openOpenVSCode() {
  if (!ensureConnected()) return;
  if (!canUseIDE.value && !isSuperAdmin.value) {
    notifyUi({ type: "warning", message: translate("infra.ideAccessDenied") });
    return;
  }
  const openInCurrentTab = shouldOpenOpenVSCodeInCurrentTab();
  const popupWindow = openInCurrentTab ? null : window.open("about:blank", "_blank");
  try {
    if (popupWindow) popupWindow.opener = null;
    const res = await postOpenVSCodeServerApi(
      { userId: userId.value },
      { fetcher: authFetch },
    );
    const data = await res.json();
    if (!res.ok || !data.ok || !data.url) {
      throw new Error(data.error || translate("infra.openVSCodeFailed"));
    }
    const ideUrl = new URL(String(data.url || ""), window.location.origin).toString();
    if (openInCurrentTab) {
      window.location.assign(ideUrl);
      return;
    }
    if (popupWindow && !popupWindow.closed) {
      popupWindow.location.replace(ideUrl);
    } else {
      window.open(ideUrl, "_blank", "noopener,noreferrer");
    }
  } catch (error) {
    if (popupWindow && !popupWindow.closed) popupWindow.close();
    notifyUi({ type: "error", message: error.message || translate("infra.openVSCodeFailed") });
  }
}

function shouldOpenOpenVSCodeInCurrentTab() {
  const userAgent = typeof navigator === "undefined" ? "" : String(navigator.userAgent || "");
  return shouldOpenOpenVSCodeInCurrentTabState({ isMobile: isMobile.value, userAgent });
}

function openConfigParams() {
  if (!ensureConnected()) return;
  closeComposerMorePanel();
  openConfigParamsRaw();
  pushPseudoRoute(buildPanelPseudoRoute(activeSessionId.value, PSEUDO_PANEL.CONFIG_PARAMS));
}

function handleToggleSidebar() {
  toggleSidebar();
  if (isMobile.value) {
    if (mobileSidebarOpen.value) closeComposerMorePanel();
    pushPseudoRoute(buildPanelVisibilityPseudoRoute({
      sessionId: activeSessionId.value,
      visible: mobileSidebarOpen.value,
      panel: PSEUDO_PANEL.SIDEBAR,
    }));
  }
}

function handleCloseMobileSidebar() {
  closeMobileSidebar();
  pushPseudoRoute(buildClosePseudoPanelRoute());
}

function handleComposerMorePanelVisibleUpdate(value) {
  const nextVisible = Boolean(value);
  if (composerMorePanelVisible.value === nextVisible) return;
  if (nextVisible) {
    closeAllDrawers();
    closeMobileSidebar();
  }
  composerMorePanelVisible.value = nextVisible;
  pushPseudoRoute(buildPanelVisibilityPseudoRoute({
    sessionId: activeSessionId.value,
    visible: nextVisible,
    panel: PSEUDO_PANEL.COMPOSER,
  }));
}

function resolveFallbackThinkingDetailsPayload() {
  return resolveFallbackThinkingDetailsPayloadState(activeSession.value);
}

function closeThinkingDetailsPanel() {
  thinkingDetailsVisible.value = false;
}

function getThinkingDetailsTitle(messageItem = {}) {
  return getThinkingDetailsTitleState(messageItem, translate);
}

function normalizeDialogProcessId(messageItem = {}) {
  return String(messageItem?.dialogProcessId || "").trim();
}

async function fetchThinkingDetailForMessage(messageItem = {}) {
  const dialogProcessId = normalizeDialogProcessId(messageItem);
  if (!dialogProcessId || typeof fetchThinkingDetail !== "function") return null;
  return fetchThinkingDetail(activeSessionId.value, { dialogProcessId });
}

async function openThinkingDetailsPanel(payload = {}) {
  let fallbackPayload = resolveFallbackThinkingDetailsPayload();
  const initialPayload = resolveThinkingDetailsPanelPayload(payload, fallbackPayload);
  const initialMessageItem = initialPayload.messageItem;
  const needsFullDetail =
    initialMessageItem &&
    (initialMessageItem.hasThinkingDetails === true || Number(initialMessageItem.thinkingDetailCount || 0) > 0) &&
    !Array.isArray(initialMessageItem.realtimeLogs);
  let loadedThinkingDetail = null;
  if (needsFullDetail) {
    try {
      loadedThinkingDetail = await fetchThinkingDetailForMessage(initialMessageItem);
    } catch (error) {
      notifyUi({ type: "warning", message: error?.message || translate("chat.loadSessionDetailFailed") });
    }
  }
  const detailPayload = loadedThinkingDetail
    ? { messageItem: loadedThinkingDetail.messageItem, allMessages: loadedThinkingDetail.allMessages }
    : payload;
  const { messageItem, allMessages } = resolveThinkingDetailsPanelPayload(detailPayload, fallbackPayload);
  if (!messageItem) return;
  closeAllDrawers();
  closeMobileSidebar();
  closeComposerMorePanel();
  thinkingDetailsMessageItem.value = messageItem;
  thinkingDetailsAllMessages.value = allMessages;
  thinkingDetailsVisible.value = true;
  if (payload?.pushRoute !== false) {
    pushPseudoRoute(buildThinkingDetailsRoute(activeSessionId.value, PSEUDO_PANEL.THINKING_DETAILS));
  }
}

watch(
  () => {
    if (!thinkingDetailsVisible.value) return "";
    const dialogProcessId = normalizeDialogProcessId(thinkingDetailsMessageItem.value);
    if (!dialogProcessId) return "";
    const sourceMessage = (activeSession.value?.messages || [])
      .find((item = {}) => normalizeDialogProcessId(item) === dialogProcessId && item?.role === "assistant") || {};
    return [
      activeSessionId.value,
      dialogProcessId,
      sourceMessage?.pending === true ? "pending" : "done",
      Number(sourceMessage?.thinkingDetailCount || 0),
    ].join("::");
  },
  async () => {
    if (!thinkingDetailsVisible.value) return;
    const currentMessage = thinkingDetailsMessageItem.value;
    const dialogProcessId = normalizeDialogProcessId(currentMessage);
    if (!dialogProcessId) return;
    try {
      const detail = await fetchThinkingDetailForMessage(currentMessage);
      if (!detail || normalizeDialogProcessId(thinkingDetailsMessageItem.value) !== dialogProcessId) return;
      thinkingDetailsMessageItem.value = detail.messageItem || currentMessage;
      thinkingDetailsAllMessages.value = Array.isArray(detail.allMessages) ? detail.allMessages : [];
    } catch {
      // Keep the already opened panel stable; explicit open still reports load errors.
    }
  },
);

function handleDrawerModelUpdate(drawer = {}, value = false) {
  const { closed } = updateDrawerModelVisibility({ drawer, value });
  if (closed) pushPseudoRoute(buildClosePseudoPanelRoute());
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
  initSessionsAfterMount();
  replacePseudoRoute();
}

function resolveDefaultSelectedModelFromConfig(config = {}) {
  const defaultModel = config?.defaultModel;
  const currentScenarioKey = String(botScenario.value || "").trim();
  const scenarioDefinition = currentScenarioKey && config?.definitions && typeof config.definitions === "object"
    ? config.definitions[currentScenarioKey] || {}
    : {};
  const scenarioDefaultModel = scenarioDefinition?.defaultModel;
  const candidates = [
    scenarioDefinition?.defaultModelAlias,
    typeof scenarioDefaultModel === "string" ? scenarioDefaultModel : "",
    scenarioDefaultModel?.value,
    scenarioDefaultModel?.alias,
    scenarioDefaultModel?.key,
    scenarioDefaultModel?.model,
    scenarioDefinition?.model,
    Array.isArray(scenarioDefinition?.enabledModels) ? scenarioDefinition.enabledModels[0]?.value : "",
    Array.isArray(scenarioDefinition?.enabledModels) ? scenarioDefinition.enabledModels[0]?.alias : "",
    Array.isArray(scenarioDefinition?.enabledModels) ? scenarioDefinition.enabledModels[0]?.key : "",
    Array.isArray(scenarioDefinition?.enabledModels) ? scenarioDefinition.enabledModels[0]?.model : "",
    config?.defaultModelAlias,
    typeof defaultModel === "string" ? defaultModel : "",
    defaultModel?.value,
    defaultModel?.alias,
    defaultModel?.key,
    defaultModel?.model,
    Array.isArray(config?.enabledModels) ? config.enabledModels[0]?.value : "",
    Array.isArray(config?.enabledModels) ? config.enabledModels[0]?.alias : "",
    Array.isArray(config?.enabledModels) ? config.enabledModels[0]?.key : "",
    Array.isArray(config?.enabledModels) ? config.enabledModels[0]?.model : "",
  ];
  return candidates.map((item) => String(item || "").trim()).find(Boolean) || "";
}

function syncSelectedModelWithConfig() {
  const currentScenarioKey = String(botScenario.value || "").trim();
  if (hasStoredSelectedModelPreference(currentScenarioKey)) {
    selectedModel.value = readSelectedModelPreference(currentScenarioKey);
    return;
  }
  const defaultModelValue = resolveDefaultSelectedModelFromConfig(scenarioConfig.value || {});
  selectedModel.value = defaultModelValue;
}

function syncPluginModelConfigWithPreference() {
  const currentScenarioKey = String(botScenario.value || "").trim();
  pluginModelConfig.value = readPluginModelConfigPreference(currentScenarioKey);
}

function onAppUnmounted() {
  removePseudoRoutePopStateListener();
  unbindChatMessageScrollSync();
  setMobileChatNavigatorDragLock(false);
  releaseAllPreviewUrls();
}

onMounted(onAppMounted);
onBeforeUnmount(onAppUnmounted);

// --- Watchers ---
watch(
  () => scenarioConfig.value,
  () => {
    syncBotScenarioWithConfig();
    syncSelectedPluginsWithConfig();
    syncSelectedModelWithConfig();
    syncPluginModelConfigWithPreference();
  },
  { deep: true, immediate: true },
);

watch(
  () => botScenario.value,
  () => {
    syncSelectedModelWithConfig();
    syncPluginModelConfigWithPreference();
  },
);

watch(
  [
    activeSessionId,
    workspaceVisible,
    userSettingsVisible,
    configParamsVisible,
    mobileSidebarOpen,
    isMobile,
    composerMorePanelVisible,
    thinkingDetailsVisible,
  ],
  () => {
    replacePseudoRoute();
  },
);

watch(
  () => activeSessionId.value,
  async (nextSessionId) => {
    if (!nextSessionId || initialPseudoRouteApplied.value) return;
    const route = parsePseudoRouteFromLocation();
    const hasPseudoRoute = Boolean(route.sessionId || route.panel);
    if (!hasPseudoRoute) {
      initialPseudoRouteApplied.value = true;
      replacePseudoRoute();
      return;
    }
    initialPseudoRouteApplied.value = true;
    await applyPseudoRoute(route);
    replacePseudoRoute();
  },
  { immediate: true },
);

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

function onAllowUserInteractionUpdate(value) {
  updateAllowUserInteractionPreference({ preferenceRef: allowUserInteraction, value });
}

function onForceToolUpdate(value) {
  updateForceToolPreference({ preferenceRef: forceTool, value });
}

function onStreamOutputUpdate(value) {
  updateStreamOutputPreference({ preferenceRef: streamOutput, value });
}

function onBotScenarioUpdate(value = "") {
  updateBotScenarioPreference({
    preferenceRef: botScenario,
    value,
    availableBotScenarios: availableBotScenarios.value,
  });
}

function onSelectedModelUpdate(value = "") {
  updateSelectedModelPreference({ preferenceRef: selectedModel, value, scenarioKey: botScenario.value });
}

function onPluginModelConfigUpdate(value = {}) {
  updatePluginModelConfigPreference({ preferenceRef: pluginModelConfig, value, scenarioKey: botScenario.value });
}

function onSelectedPluginsUpdate(value = []) {
  const selectablePluginKeySet = new Set(
    availablePlugins.value
      .filter((pluginItem) => pluginItem?.enabled === true)
      .map((pluginItem) => String(pluginItem?.key || "").trim())
      .filter(Boolean),
  );
  selectedPlugins.value = (Array.isArray(value) ? value : [])
    .map((pluginKey) => String(pluginKey || "").trim())
    .filter((pluginKey) => pluginKey && selectablePluginKeySet.has(pluginKey));
  persistSelectedPlugins();
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
        @click="handleCloseMobileSidebar"
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
        @toggle-sidebar="handleToggleSidebar"
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
        :can-use-ide="canUseIDE"
        @toggle-sidebar="handleToggleSidebar"
        @open-openvscode="openOpenVSCode"
        @open-workspace="openWorkspace"
        @open-user-settings="openUserSettings"
        @open-config-params="openConfigParams"
      />

      <div class="chat-content-body">
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
          :sending="sending"
          :delete-monotonic-message="deleteMonotonicMessage"
          :resend-monotonic-message="resendMonotonicMessage"
          @open-thinking-details="openThinkingDetailsPanel"
        />

        <aside
          v-if="!isMobile && chatMessageNavItems.length"
          class="chat-message-nav-panel noobot-flat-card"
        >
          <div class="chat-message-nav-header">
            <div class="chat-message-nav-title-group">
              <span class="chat-message-nav-icon"><el-icon><Tickets /></el-icon></span>
              <div>
                <span class="chat-message-nav-title">{{ translate("common.chatNavigator") }}</span>
                <span class="chat-message-nav-count">{{ chatMessageNavItems.length }}</span>
              </div>
            </div>
            <el-button text size="small" class="chat-message-nav-toggle" @click="chatNavigatorVisible = !chatNavigatorVisible">
              {{ chatNavigatorVisible ? translate("common.hideChatNavigator") : translate("common.showChatNavigator") }}
            </el-button>
          </div>
          <el-affix :offset="80">
            <ChatMessageNavigator
              v-show="chatNavigatorVisible"
              :items="chatMessageNavItems"
              :current-id="currentMessageAnchorId"
              @select="handleSelectChatMessageNavItem"
            />
          </el-affix>
        </aside>

        <el-button
          v-if="isMobile && chatMessageNavItems.length"
          class="mobile-chat-message-nav-trigger"
          :class="{ 'is-dragging': mobileChatNavigatorTriggerDragging }"
          :style="mobileChatNavigatorTriggerStyle"
          type="primary"
          circle
          size="large"
          :aria-label="translate('common.chatNavigator')"
          @click="handleMobileChatNavigatorTriggerClick"
          @pointerdown="handleMobileChatNavigatorTriggerPointerDown"
          @pointermove="handleMobileChatNavigatorTriggerPointerMove"
          @pointerup="handleMobileChatNavigatorTriggerPointerUp"
          @pointercancel="handleMobileChatNavigatorTriggerPointerUp"
          @touchstart.stop.prevent
          @touchmove.stop.prevent
          @touchend.stop.prevent
          @touchcancel.stop.prevent
        >
          <el-icon class="mobile-chat-message-nav-trigger-icon"><Tickets /></el-icon>
        </el-button>
      </div>

      <div class="chat-composer-body">
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
          :more-panel-visible="composerMorePanelVisible"
          :upload-files="uploadFiles"
          :connector-panel-state="activeSession?.connectorPanelState || {}"
          :sending="sending"
          :can-stop="sending"
          :connected="connected"
          :allow-user-interaction="allowUserInteraction"
          :force-tool="forceTool"
          :stream-output="streamOutput"
          :bot-scenario="botScenario"
          :selected-model="selectedModel"
          :model-options="availableModelOptions"
          :plugin-model-config="pluginModelConfig"
          :scenario-options="availableBotScenarios"
          :available-plugins="availablePlugins"
          :selected-plugins="selectedPlugins"
          :interaction-active="Boolean(pendingInteractionRequest)"
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
      </div>
      <ConversationStateDebugPanel
        v-if="showConversationStateDebugPanel"
        :sending="sending"
        :interaction-submitting="interactionSubmitting"
        :pending-interaction-request="pendingInteractionRequest"
        :conversation-state-snapshot="conversationStateSnapshot"
        :conversation-state-timeline="conversationStateTimeline"
      />
      </main>
      <el-drawer
        v-for="drawer in drawerPanels"
        :key="drawer.key"
        :model-value="drawer.model.value"
        @update:model-value="handleDrawerModelUpdate(drawer, $event)"
        :title="drawer.title"
        :size="drawerSize"
        destroy-on-close
        class="workspace-drawer noobot-side-drawer"
      >
        <component
          :is="drawer.component"
          v-bind="drawer.props"
          @workspace-reset="drawer.onWorkspaceReset?.()"
        />
      </el-drawer>
      <el-drawer
        v-if="isMobile"
        v-model="mobileChatNavigatorVisible"
        :title="translate('common.chatNavigator')"
        @closed="handleMobileChatNavigatorClosed"
        direction="rtl"
        size="82%"
        class="chat-message-nav-drawer noobot-side-drawer"
      >
        <ChatMessageNavigator
          :items="chatMessageNavItems"
          :current-id="currentMessageAnchorId"
          @select="handleSelectChatMessageNavItem"
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
  overscroll-behavior: none;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--noobot-panel-bg);
  min-width: 0;
  min-height: 0;
  overscroll-behavior: none;
}

.app-shell-root,
.chat-content-body,
.chat-composer-body {
  overscroll-behavior: none;
}

@media (min-width: 961px) {
  .chat-content-body,
  .chat-composer-body {
    padding-right: 268px;
  }
}

.chat-content-body {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
}

.chat-composer-body {
  flex-shrink: 0;
  background: var(--noobot-panel-bg);
  box-sizing: border-box;
}

.chat-message-nav-panel {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 8;
  width: 236px;
  max-width: 24vw;
  padding: 12px;
  border: 1px solid var(--noobot-border-soft);
  border-radius: 18px;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--el-color-primary) 10%, transparent), transparent 62%),
    var(--noobot-panel-bg);
  box-shadow: var(--noobot-card-shadow);
  backdrop-filter: blur(14px);
}

.chat-message-nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--noobot-text-main);
}

.chat-message-nav-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.chat-message-nav-icon {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 10px;
  color: var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
  font-weight: 700;
}

.chat-message-nav-title {
  display: inline-flex;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
}

.chat-message-nav-count {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--noobot-text-secondary);
}

.chat-message-nav-toggle {
  flex: 0 0 auto;
}

.mobile-chat-message-nav-trigger {
  position: fixed;
  z-index: 16;
  width: 44px;
  height: 44px;
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 24%, transparent);
  background: var(--noobot-panel-bg);
  color: var(--el-color-primary);
  box-shadow: var(--noobot-card-shadow);
  touch-action: none;
  overscroll-behavior: none;
  cursor: grab;
  user-select: none;
}

.mobile-chat-message-nav-trigger.is-dragging {
  cursor: grabbing;
  opacity: 0.92;
}

:global(html.noobot-mobile-chat-navigator-dragging),
:global(body.noobot-mobile-chat-navigator-dragging) {
  overscroll-behavior-y: none;
  touch-action: none;
}

:global(body.noobot-mobile-chat-navigator-dragging) {
  overflow: hidden;
}

:global(body.noobot-mobile-chat-navigator-dragging) .app-shell-root,
:global(body.noobot-mobile-chat-navigator-dragging) .chat-page,
:global(body.noobot-mobile-chat-navigator-dragging) .main-content,
:global(body.noobot-mobile-chat-navigator-dragging) .chat-content-body {
  overscroll-behavior: none;
  touch-action: none;
}

.mobile-chat-message-nav-trigger-icon {
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
}

@media (max-width: 960px) {
  .chat-message-nav-panel {
    display: none;
  }
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
  .app-shell-root { min-height: 100svh; }

}
</style>
