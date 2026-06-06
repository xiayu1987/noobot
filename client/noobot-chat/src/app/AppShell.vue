<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import noobotLogo from "../shared/assets/noobot.svg";
import WorkspacePanel from "../modules/settings/WorkspacePanel.vue";
import UserSettingsPanel from "../modules/settings/UserSettingsPanel.vue";
import ConfigParamsPanel from "../modules/settings/ConfigParamsPanel.vue";
import UserInteractionForm from "../modules/composer/UserInteractionForm.vue";
import ChatComposer from "../modules/composer/ChatComposer.vue";
import ConversationStateDebugPanel from "../modules/debug/ConversationStateDebugPanel.vue";
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
import { frontendConfig } from "../shared/config/frontendConfig";
import { postOpenVSCodeServerApi } from "../services/api/chatApi";

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
const hasStoredSelectedPlugins = ref(
  localStorage.getItem(SELECTED_PLUGINS_STORAGE_KEY) !== null,
);
const selectedPlugins = ref(
  safeParseStringArray(localStorage.getItem(SELECTED_PLUGINS_STORAGE_KEY)),
);
const composerRef = ref();
const messageListPanelRef = ref();

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

function persistSelectedPlugins() {
  hasStoredSelectedPlugins.value = true;
  localStorage.setItem(SELECTED_PLUGINS_STORAGE_KEY, JSON.stringify(selectedPlugins.value));
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
  if (!hasStoredSelectedPlugins.value) {
    selectedPlugins.value = pluginOptions
      .filter(
        (pluginItem) =>
          pluginItem.enabled === true && String(pluginItem.mode || "").toLowerCase() === "on",
      )
      .map((pluginItem) => pluginItem.key);
    return;
  }
  selectedPlugins.value = selectedPlugins.value.filter((pluginKey) =>
    availablePluginKeySet.has(pluginKey) && enabledPluginKeySet.has(pluginKey),
  );
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

const PSEUDO_ROUTE_SESSION_KEY = "session";
const PSEUDO_ROUTE_PANEL_KEY = "panel";
const PANEL_WORKSPACE = "workspace";
const PANEL_USER_SETTINGS = "user-settings";
const PANEL_CONFIG_PARAMS = "config-params";
const PANEL_SIDEBAR = "sidebar";

const applyingPseudoHistory = ref(false);
const initialPseudoRouteApplied = ref(false);

function normalizePanel(panel = "") {
  const value = String(panel || "").trim();
  if (
    value === PANEL_WORKSPACE ||
    value === PANEL_USER_SETTINGS ||
    value === PANEL_CONFIG_PARAMS ||
    value === PANEL_SIDEBAR
  ) {
    return value;
  }
  return "";
}

function parsePseudoRouteFromLocation() {
  const params = new URLSearchParams(window.location.search || "");
  return {
    sessionId: String(params.get(PSEUDO_ROUTE_SESSION_KEY) || "").trim(),
    panel: normalizePanel(params.get(PSEUDO_ROUTE_PANEL_KEY) || ""),
  };
}

function resolveActivePseudoPanel() {
  if (workspaceVisible.value) return PANEL_WORKSPACE;
  if (userSettingsVisible.value) return PANEL_USER_SETTINGS;
  if (configParamsVisible.value) return PANEL_CONFIG_PARAMS;
  if (mobileSidebarOpen.value && isMobile.value) return PANEL_SIDEBAR;
  return "";
}

function buildPseudoRouteFromCurrentState(patch = {}) {
  const currentSessionId = String(activeSessionId.value || "").trim();
  const currentPanel = resolveActivePseudoPanel();
  const nextSessionId = Object.prototype.hasOwnProperty.call(patch, "sessionId")
    ? String(patch.sessionId || "").trim()
    : currentSessionId;
  const nextPanel = Object.prototype.hasOwnProperty.call(patch, "panel")
    ? normalizePanel(patch.panel)
    : currentPanel;
  return { sessionId: nextSessionId, panel: nextPanel };
}

function writePseudoRouteHistory(route = {}, { mode = "replace" } = {}) {
  const nextRoute = buildPseudoRouteFromCurrentState(route);
  const params = new URLSearchParams(window.location.search || "");
  if (nextRoute.sessionId) {
    params.set(PSEUDO_ROUTE_SESSION_KEY, nextRoute.sessionId);
  } else {
    params.delete(PSEUDO_ROUTE_SESSION_KEY);
  }
  if (nextRoute.panel) {
    params.set(PSEUDO_ROUTE_PANEL_KEY, nextRoute.panel);
  } else {
    params.delete(PSEUDO_ROUTE_PANEL_KEY);
  }
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
  const nextState = {
    ...(history.state && typeof history.state === "object" ? history.state : {}),
    noobotPseudoRoute: nextRoute,
  };
  if (mode === "push") {
    history.pushState(nextState, "", nextUrl);
    return;
  }
  history.replaceState(nextState, "", nextUrl);
}

async function applyPseudoRoute(route = {}) {
  const targetSessionId = String(route.sessionId || "").trim();
  const targetPanel = normalizePanel(route.panel || "");
  applyingPseudoHistory.value = true;
  try {
    closeAllDrawers();
    closeMobileSidebar();
    if (targetSessionId) {
      await handleSelectSession(targetSessionId, {
        fromHistory: true,
        force: true,
        preserveCurrentMessages: true,
        silent: true,
      });
    }
    if (targetPanel === PANEL_WORKSPACE) openWorkspaceRaw();
    if (targetPanel === PANEL_USER_SETTINGS && isSuperAdmin.value) openUserSettingsRaw();
    if (targetPanel === PANEL_CONFIG_PARAMS) openConfigParamsRaw();
    if (targetPanel === PANEL_SIDEBAR) openMobileSidebar();
  } finally {
    applyingPseudoHistory.value = false;
  }
}

function pushPseudoRoute(route = {}) {
  if (applyingPseudoHistory.value) return;
  writePseudoRouteHistory(route, { mode: "push" });
}

function replacePseudoRoute(route = {}) {
  if (applyingPseudoHistory.value) return;
  writePseudoRouteHistory(route, { mode: "replace" });
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
  openWorkspaceRaw();
  pushPseudoRoute({
    sessionId: activeSessionId.value,
    panel: PANEL_WORKSPACE,
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
  openUserSettingsRaw();
  pushPseudoRoute({
    sessionId: activeSessionId.value,
    panel: PANEL_USER_SETTINGS,
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
  openConfigParamsRaw();
  pushPseudoRoute({
    sessionId: activeSessionId.value,
    panel: PANEL_CONFIG_PARAMS,
  });
}

function handleToggleSidebar() {
  toggleSidebar();
  if (isMobile.value) {
    pushPseudoRoute({
      sessionId: activeSessionId.value,
      panel: mobileSidebarOpen.value ? PANEL_SIDEBAR : "",
    });
  }
}

function handleCloseMobileSidebar() {
  closeMobileSidebar();
  replacePseudoRoute({ panel: "" });
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
async function handlePseudoRoutePopState(event) {
  const routeFromState =
    event?.state && typeof event.state === "object" ? event.state.noobotPseudoRoute : null;
  const route = routeFromState && typeof routeFromState === "object"
    ? routeFromState
    : parsePseudoRouteFromLocation();
  await applyPseudoRoute(route);
}

async function onAppMounted() {
  window.addEventListener("popstate", handlePseudoRoutePopState);
  const autoConnected = await tryAutoConnect();
  if (autoConnected) {
    replacePseudoRoute();
    return;
  }
  initSessionsAfterMount();
  replacePseudoRoute();
}

function onAppUnmounted() {
  window.removeEventListener("popstate", handlePseudoRoutePopState);
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
  [activeSessionId, workspaceVisible, userSettingsVisible, configParamsVisible, mobileSidebarOpen, isMobile],
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
        @clear-uploads="clearUploads"
        @connector-selected="onConnectorSelected"
        @send="send"
        @stop="stopSending"
      />
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
        v-model="drawer.model.value"
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
