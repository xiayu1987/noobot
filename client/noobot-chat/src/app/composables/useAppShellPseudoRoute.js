/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nextTick, watch } from "vue";
import { PSEUDO_PANEL, usePseudoRoute } from "../../shared/composables/usePseudoRoute.js";
import {
  buildClosePseudoPanelRoute,
  buildPanelPseudoRoute,
  buildPanelVisibilityPseudoRoute,
  buildSessionPseudoRoute,
  resolveActivePseudoPanel as resolveActivePseudoPanelState,
} from "../routing/appShellRoutePayload.js";

export { PSEUDO_PANEL };

export function useAppShellPseudoRoute({
  activeSessionId,
  activeSession,
  currentMessageAnchorId,
  messageListPanelRef,
  workspaceVisible,
  connectorVisible,
  userSettingsVisible,
  configParamsVisible,
  mobileSidebarOpen,
  isMobile,
  composerMorePanelVisible,
  thinkingDetailsVisible,
  mobileChatNavigatorVisible,
  chatNavigatorVisible,
  isSuperAdmin,
  closeAllDrawers,
  closeMobileSidebar,
  openMobileSidebar,
  openWorkspaceRaw,
  openConnectorsRaw,
  openUserSettingsRaw,
  openConfigParamsRaw,
  closeComposerMorePanel,
  closeThinkingDetailsPanel,
  openThinkingDetailsPanel,
  closeMobileSidebarOnSelect,
  selectSession,
} = {}) {
  function closeAllPseudoPanels() {
    closeAllDrawers?.();
    closeMobileSidebar?.();
    closeComposerMorePanel?.();
    closeThinkingDetailsPanel?.();
    if (mobileChatNavigatorVisible) mobileChatNavigatorVisible.value = false;
  }

  function resolveActivePseudoPanel() {
    return resolveActivePseudoPanelState({
      workspaceVisible: workspaceVisible?.value,
      connectorVisible: connectorVisible?.value,
      userSettingsVisible: userSettingsVisible?.value,
      configParamsVisible: configParamsVisible?.value,
      mobileSidebarOpen: mobileSidebarOpen?.value,
      isMobile: isMobile?.value,
      composerMorePanelVisible: composerMorePanelVisible?.value,
      thinkingDetailsVisible: thinkingDetailsVisible?.value,
      mobileChatNavigatorVisible: mobileChatNavigatorVisible?.value,
      panels: PSEUDO_PANEL,
    });
  }

  function isLoadedActiveSessionRouteTarget(sessionId = "") {
    const targetSessionId = String(sessionId || "").trim();
    const currentSession = activeSession?.value || null;
    if (!targetSessionId || !currentSession?.loaded) return false;
    const currentIds = [activeSessionId?.value, currentSession.sessionId]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return currentIds.includes(targetSessionId);
  }

  function resolveRoutableSessionId() {
    if (activeSession?.value?.isLocal === true) return "";
    return String(activeSessionId?.value || "").trim();
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
        silent: true,
      });
    }
    if (targetPanel === PSEUDO_PANEL.WORKSPACE) openWorkspaceRaw?.();
    if (targetPanel === PSEUDO_PANEL.CONNECTORS) {
      if (chatNavigatorVisible) chatNavigatorVisible.value = false;
      openConnectorsRaw?.();
    }
    if (targetPanel === PSEUDO_PANEL.USER_SETTINGS && isSuperAdmin?.value) openUserSettingsRaw?.();
    if (targetPanel === PSEUDO_PANEL.CONFIG_PARAMS) openConfigParamsRaw?.();
    if (targetPanel === PSEUDO_PANEL.SIDEBAR) openMobileSidebar?.();
    if (targetPanel === PSEUDO_PANEL.COMPOSER && composerMorePanelVisible)
      composerMorePanelVisible.value = true;
    if (targetPanel === PSEUDO_PANEL.THINKING_DETAILS)
      openThinkingDetailsPanel?.({ pushRoute: false });
    if (
      targetPanel === PSEUDO_PANEL.CHAT_NAVIGATOR &&
      isMobile?.value &&
      mobileChatNavigatorVisible
    ) {
      mobileChatNavigatorVisible.value = true;
    }
    if (targetAnchor) {
      currentMessageAnchorId.value = targetAnchor;
      await nextTick();
      messageListPanelRef?.value?.scrollToMessageAnchor?.(targetAnchor);
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
    resolveCurrentSessionId: resolveRoutableSessionId,
    resolveCurrentPanel: resolveActivePseudoPanel,
    resolveCurrentAnchor: () => currentMessageAnchorId?.value,
    applyRoute: applyPseudoRouteToUi,
  });

  async function applyInitialPseudoRoute(route = parsePseudoRouteFromLocation()) {
    if (initialPseudoRouteApplied.value) return false;
    initialPseudoRouteApplied.value = true;
    await applyPseudoRoute(route);
    replacePseudoRoute();
    return true;
  }

  async function handleSelectSession(sessionId, options = {}) {
    const { fromHistory = false, ...selectOptions } = options || {};
    const previousSessionId = String(activeSessionId?.value || "").trim();
    closeMobileSidebarOnSelect?.(isMobile, mobileSidebarOpen);
    await selectSession?.(sessionId, selectOptions);
    const nextSessionId = resolveRoutableSessionId();
    if (
      !fromHistory &&
      !selectOptions.silent &&
      nextSessionId &&
      nextSessionId !== previousSessionId
    ) {
      pushPseudoRoute(buildSessionPseudoRoute(nextSessionId));
    }
  }

  function pushPanelPseudoRoute(sessionId = "", panel = "") {
    pushPseudoRoute(buildPanelPseudoRoute(sessionId, panel));
  }

  function pushPanelVisibilityPseudoRoute({ sessionId = "", visible = false, panel = "" } = {}) {
    pushPseudoRoute(buildPanelVisibilityPseudoRoute({ sessionId, visible, panel }));
  }

  function pushClosePseudoPanelRoute() {
    pushPseudoRoute(buildClosePseudoPanelRoute());
  }

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
      if (!initialPseudoRouteApplied.value) return;
      replacePseudoRoute();
    },
  );

  return {
    initialPseudoRouteApplied,
    parsePseudoRouteFromLocation,
    applyPseudoRoute,
    applyInitialPseudoRoute,
    pushPseudoRoute,
    replacePseudoRoute,
    addPseudoRoutePopStateListener,
    removePseudoRoutePopStateListener,
    closeAllPseudoPanels,
    resolveActivePseudoPanel,
    applyPseudoRouteToUi,
    handleSelectSession,
    pushPanelPseudoRoute,
    pushPanelVisibilityPseudoRoute,
    pushClosePseudoPanelRoute,
  };
}
