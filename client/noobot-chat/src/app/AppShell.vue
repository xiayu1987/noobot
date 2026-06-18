<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import { Tickets } from "@element-plus/icons-vue";
import noobotLogo from "../shared/assets/noobot.svg";
import WorkspacePanel from "../modules/settings/WorkspacePanel.vue";
import UserSettingsPanel from "../modules/settings/UserSettingsPanel.vue";
import ConfigParamsPanel from "../modules/settings/ConfigParamsPanel.vue";
import UserInteractionForm from "../modules/composer/UserInteractionForm.vue";
import ChatComposer from "../modules/composer/ChatComposer.vue";
import ConversationStateDebugPanel from "../modules/debug/ConversationStateDebugPanel.vue";
import ChatMainHeader from "./ChatMainHeader.vue";
import ChatMessageListPanel from "./ChatMessageListPanel.vue";
import ChatMessageNavigator from "./ChatMessageNavigator.vue";
import ThinkingPanel from "../shared/message/ThinkingPanel.vue";
import SessionSidebar from "../modules/session/SessionSidebar.vue";
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
import { sanitizeExecutionLogText } from "../composables/chat/chatEngine/utils";

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
const userId = ref(localStorage.getItem("noobot_user_id") || "user-001");
const allowUserInteraction = ref(
  localStorage.getItem("noobot_allow_user_interaction") !== "false",
);
const forceTool = ref(localStorage.getItem("noobot_force_tool") === "true");
const streamOutput = ref(localStorage.getItem("noobot_stream_output") !== "false");
const botScenario = ref(
  String(localStorage.getItem("noobot_bot_scenario") || "").trim(),
);
const SELECTED_PLUGINS_STORAGE_KEY = "noobot_selected_plugins";
const DEFAULT_ON_PLUGINS_STORAGE_KEY = "noobot_default_on_plugins";
const hasStoredSelectedPlugins = ref(
  localStorage.getItem(SELECTED_PLUGINS_STORAGE_KEY) !== null,
);
const selectedPlugins = ref(
  safeParseStringArray(localStorage.getItem(SELECTED_PLUGINS_STORAGE_KEY)),
);
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

function safeParseStringArray(rawValue = "") {
  try {
    const parsed = JSON.parse(String(rawValue || "[]"));
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}


function loadMobileChatNavigatorTriggerPosition() {
  const defaultPosition = { right: 16, bottom: 112 };
  try {
    const rawValue = localStorage.getItem("noobot_mobile_chat_navigator_trigger_position");
    if (!rawValue) return defaultPosition;
    const parsed = JSON.parse(rawValue);
    const left = Number(parsed?.left);
    const top = Number(parsed?.top);
    return Number.isFinite(left) && Number.isFinite(top) ? { left, top } : defaultPosition;
  } catch {
    return defaultPosition;
  }
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

function clampMobileChatNavigatorTriggerPosition(left, top) {
  const triggerSize = 44;
  const edgeGap = 8;
  const viewportWidth = Number(window?.innerWidth || 0);
  const viewportHeight = Number(window?.innerHeight || 0);
  return {
    left: Math.min(Math.max(edgeGap, Number(left || 0)), Math.max(edgeGap, viewportWidth - triggerSize - edgeGap)),
    top: Math.min(Math.max(edgeGap, Number(top || 0)), Math.max(edgeGap, viewportHeight - triggerSize - edgeGap)),
  };
}

function persistMobileChatNavigatorTriggerPosition(position = {}) {
  try {
    localStorage.setItem(
      "noobot_mobile_chat_navigator_trigger_position",
      JSON.stringify({ left: Math.round(Number(position.left || 0)), top: Math.round(Number(position.top || 0)) }),
    );
  } catch {
    // Ignore storage quota/privacy errors.
  }
}

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

const availablePlugins = computed(() => {
  const definitions =
    scenarioConfig?.value?.plugins && typeof scenarioConfig.value.plugins === "object"
      ? scenarioConfig.value.plugins
      : {};
  return Object.entries(definitions)
    .map(([pluginKey, pluginDefinition]) => {
      const source = pluginDefinition && typeof pluginDefinition === "object" ? pluginDefinition : {};
      return {
        key: String(pluginKey || "").trim(),
        label: String(source?.label || source?.name || pluginKey || "").trim(),
        description: String(source?.description || "").trim(),
        enabled: source?.enabled === true,
        mode: String(source?.mode || "")
          .trim()
          .toLowerCase() === "on"
          ? "on"
          : "off",
      };
    })
    .filter((pluginItem) => Boolean(pluginItem.key) && pluginItem.enabled === true);
});

const chatMessageNavItems = computed(() =>
  (activeSession.value?.messages || [])
    .map((messageItem = {}, messageIndex = 0) => {
      if (!shouldRenderMessageInChat(messageItem)) return null;
      const anchorId = messageListPanelRef.value?.getMessageAnchorId?.(messageItem, messageIndex);
      const role = String(messageItem?.role || translate("common.session")).trim();
      const content = String(messageItem?.content || messageItem?.text || "").replace(/\s+/g, " ").trim();
      return {
        id: anchorId || `chat-message-${messageIndex}`,
        title: `${messageIndex + 1}. ${role}${content ? `：${content.slice(0, 28)}` : ""}`,
      };
    })
    .filter(Boolean),
);

function handleSelectChatMessageNavItem(item = {}) {
  const anchor = String(item?.id || "").trim();
  currentMessageAnchorId.value = anchor;
  messageListPanelRef.value?.scrollToMessageAnchor?.(anchor);
  if (isMobile.value) {
    mobileChatNavigatorVisible.value = false;
  }
  pushPseudoRoute({
    sessionId: activeSessionId.value,
    panel: "",
    anchor,
  });
}

function openChatMessageNavigator() {
  mobileChatNavigatorVisible.value = true;
  pushPseudoRoute({
    sessionId: activeSessionId.value,
    panel: PSEUDO_PANEL.CHAT_NAVIGATOR,
    anchor: currentMessageAnchorId.value,
  });
}

function handleMobileChatNavigatorClosed() {
  replacePseudoRoute({
    sessionId: activeSessionId.value,
    panel: "",
    anchor: currentMessageAnchorId.value,
  });
}

function syncCurrentMessageAnchorId() {
  const wrapRef = messageListPanelRef.value?.getWrapRef?.();
  if (!wrapRef) return;
  const anchors = Array.from(wrapRef.querySelectorAll?.("[data-chat-message-anchor]") || []);
  if (!anchors.length) {
    currentMessageAnchorId.value = "";
    return;
  }
  const threshold = Number(wrapRef.scrollTop || 0) + 24;
  let currentAnchor = anchors[0];
  for (const anchor of anchors) {
    if (Number(anchor.offsetTop || 0) <= threshold) currentAnchor = anchor;
    else break;
  }
  currentMessageAnchorId.value = String(
    currentAnchor?.dataset?.chatMessageAnchor || currentAnchor?.id || "",
  );
}

function bindChatMessageScrollSync() {
  const wrapRef = messageListPanelRef.value?.getWrapRef?.();
  if (!wrapRef || wrapRef.__noobotChatNavScrollSyncBound) return;
  wrapRef.addEventListener?.("scroll", syncCurrentMessageAnchorId, { passive: true });
  wrapRef.__noobotChatNavScrollSyncBound = true;
  syncCurrentMessageAnchorId();
}

function unbindChatMessageScrollSync() {
  const wrapRef = messageListPanelRef.value?.getWrapRef?.();
  if (!wrapRef || !wrapRef.__noobotChatNavScrollSyncBound) return;
  wrapRef.removeEventListener?.("scroll", syncCurrentMessageAnchorId);
  delete wrapRef.__noobotChatNavScrollSyncBound;
}

function persistSelectedPlugins() {
  hasStoredSelectedPlugins.value = true;
  localStorage.setItem(SELECTED_PLUGINS_STORAGE_KEY, JSON.stringify(selectedPlugins.value));
}

function getDefaultOnPluginKeys(pluginOptions = []) {
  return (Array.isArray(pluginOptions) ? pluginOptions : [])
    .filter(
      (pluginItem) =>
        pluginItem?.enabled === true &&
        String(pluginItem?.mode || "").toLowerCase() === "on",
    )
    .map((pluginItem) => String(pluginItem?.key || "").trim())
    .filter(Boolean);
}

function persistDefaultOnPluginKeys(pluginKeys = []) {
  const normalizedPluginKeys = (Array.isArray(pluginKeys) ? pluginKeys : [])
    .map((pluginKey) => String(pluginKey || "").trim())
    .filter(Boolean);
  localStorage.setItem(
    DEFAULT_ON_PLUGINS_STORAGE_KEY,
    JSON.stringify(Array.from(new Set(normalizedPluginKeys))),
  );
}

function syncSelectedPluginsWithConfig() {
  const pluginOptions = Array.isArray(availablePlugins.value) ? availablePlugins.value : [];
  if (!pluginOptions.length) {
    // 连接前 scenarioConfig 为空，避免把本地已选插件误清空并持久化。
    return;
  }
  const availablePluginKeySet = new Set(pluginOptions.map((item) => item.key));
  const enabledPluginKeySet = new Set(
    pluginOptions.filter((item) => item.enabled === true).map((item) => item.key),
  );
  const defaultOnPluginKeys = getDefaultOnPluginKeys(pluginOptions);
  const previousDefaultOnPluginKeySet = new Set(
    safeParseStringArray(localStorage.getItem(DEFAULT_ON_PLUGINS_STORAGE_KEY)),
  );
  if (!hasStoredSelectedPlugins.value) {
    selectedPlugins.value = defaultOnPluginKeys;
    persistDefaultOnPluginKeys(defaultOnPluginKeys);
    return;
  }
  const selectedPluginKeySet = new Set(
    selectedPlugins.value.filter((pluginKey) =>
      availablePluginKeySet.has(pluginKey) && enabledPluginKeySet.has(pluginKey),
    ),
  );
  // 配置从“非工作流/插件 off”切回“插件 mode=on”时，本地已持久化的 []
  // 不应永久压过新的后端默认开启配置；只补齐“本次配置新增为默认开启”的插件。
  for (const pluginKey of defaultOnPluginKeys) {
    if (!previousDefaultOnPluginKeySet.has(pluginKey)) {
      selectedPluginKeySet.add(pluginKey);
    }
  }
  selectedPlugins.value = Array.from(selectedPluginKeySet);
  persistDefaultOnPluginKeys(defaultOnPluginKeys);
  persistSelectedPlugins();
}

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
  const text = sanitizeExecutionLogText(data.text || "");
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
    ...data,
    event: eventName || "system",
    type: type || (isTool ? "tool_call" : "system"),
    text,
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
  if (workspaceVisible.value) return PSEUDO_PANEL.WORKSPACE;
  if (userSettingsVisible.value) return PSEUDO_PANEL.USER_SETTINGS;
  if (configParamsVisible.value) return PSEUDO_PANEL.CONFIG_PARAMS;
  if (mobileSidebarOpen.value && isMobile.value) return PSEUDO_PANEL.SIDEBAR;
  if (composerMorePanelVisible.value) return PSEUDO_PANEL.COMPOSER;
  if (thinkingDetailsVisible.value) return PSEUDO_PANEL.THINKING_DETAILS;
  if (mobileChatNavigatorVisible.value && isMobile.value) return PSEUDO_PANEL.CHAT_NAVIGATOR;
  return "";
}

async function applyPseudoRouteToUi(route = {}) {
  const targetSessionId = String(route.sessionId || "").trim();
  const targetPanel = String(route.panel || "").trim();
  const targetAnchor = String(route.anchor || "").trim();
  closeAllPseudoPanels();
  if (targetSessionId) {
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
    pushPseudoRoute({
      sessionId: nextSessionId,
      panel: "",
    });
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
  pushPseudoRoute({
    sessionId: activeSessionId.value,
    panel: PSEUDO_PANEL.WORKSPACE,
  });
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
  pushPseudoRoute({
    sessionId: activeSessionId.value,
    panel: PSEUDO_PANEL.USER_SETTINGS,
  });
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
  return isMobile.value || /Android/i.test(userAgent);
}

function openConfigParams() {
  if (!ensureConnected()) return;
  closeComposerMorePanel();
  openConfigParamsRaw();
  pushPseudoRoute({
    sessionId: activeSessionId.value,
    panel: PSEUDO_PANEL.CONFIG_PARAMS,
  });
}

function handleToggleSidebar() {
  toggleSidebar();
  if (isMobile.value) {
    if (mobileSidebarOpen.value) closeComposerMorePanel();
    pushPseudoRoute({
      sessionId: activeSessionId.value,
      panel: mobileSidebarOpen.value ? PSEUDO_PANEL.SIDEBAR : "",
    });
  }
}

function handleCloseMobileSidebar() {
  closeMobileSidebar();
  pushPseudoRoute({ panel: "" });
}

function handleComposerMorePanelVisibleUpdate(value) {
  const nextVisible = Boolean(value);
  if (composerMorePanelVisible.value === nextVisible) return;
  if (nextVisible) {
    closeAllDrawers();
    closeMobileSidebar();
  }
  composerMorePanelVisible.value = nextVisible;
  pushPseudoRoute({
    sessionId: activeSessionId.value,
    panel: nextVisible ? PSEUDO_PANEL.COMPOSER : "",
  });
}

function resolveFallbackThinkingDetailsPayload() {
  const messages = activeSession.value?.rawMessages || activeSession.value?.messages || [];
  const messageItem = [...messages].reverse().find((item = {}) =>
    item?.role === "assistant" && (item?.pending || Array.isArray(item?.realtimeLogs) || Array.isArray(item?.completedToolLogs))
  );
  return { messageItem: messageItem || null, allMessages: messages };
}

function closeThinkingDetailsPanel() {
  thinkingDetailsVisible.value = false;
}

function getThinkingDetailsCount(messageItem = {}) {
  if (Array.isArray(messageItem?.completedToolLogs)) {
    return messageItem.completedToolLogs.length;
  }
  if (Array.isArray(messageItem?.toolCalls)) {
    return messageItem.toolCalls.length;
  }
  if (Array.isArray(messageItem?.realtimeLogs)) {
    return messageItem.realtimeLogs.filter((logItem = {}) => {
      const event = String(logItem?.event || logItem?.type || "").toLowerCase();
      return event.includes("tool") || event.includes("function");
    }).length;
  }
  return 0;
}

function getThinkingDetailsTitle(messageItem = {}) {
  return translate("message.thinkingDetails", { count: getThinkingDetailsCount(messageItem) });
}

function openThinkingDetailsPanel(payload = {}) {
  const fallbackPayload = resolveFallbackThinkingDetailsPayload();
  const messageItem = payload?.messageItem || fallbackPayload.messageItem;
  if (!messageItem) return;
  closeAllDrawers();
  closeMobileSidebar();
  closeComposerMorePanel();
  thinkingDetailsMessageItem.value = messageItem;
  thinkingDetailsAllMessages.value = Array.isArray(payload?.allMessages)
    ? payload.allMessages
    : fallbackPayload.allMessages;
  thinkingDetailsVisible.value = true;
  if (payload?.pushRoute !== false) {
    pushPseudoRoute({
      sessionId: activeSessionId.value,
      panel: PSEUDO_PANEL.THINKING_DETAILS,
    });
  }
}

function handleDrawerModelUpdate(drawer = {}, value = false) {
  const nextVisible = Boolean(value);
  const model = drawer?.model;
  if (!model || typeof model !== "object" || !("value" in model)) return;
  if (model.value === nextVisible) return;
  model.value = nextVisible;
  if (!nextVisible) {
    pushPseudoRoute({ panel: "" });
  }
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
  },
  { deep: true, immediate: true },
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

function onStreamOutputUpdate(value) {
  streamOutput.value = Boolean(value);
  localStorage.setItem("noobot_stream_output", streamOutput.value ? "true" : "false");
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
    key: "thinking-details",
    model: thinkingDetailsVisible,
    title: getThinkingDetailsTitle(thinkingDetailsMessageItem.value || {}),
    component: ThinkingPanel,
    props: {
      messageItem: thinkingDetailsMessageItem.value || {},
      allMessages: thinkingDetailsAllMessages.value,
      variant: "details",
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
