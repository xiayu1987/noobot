/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nextTick, watch } from "vue";
import { PSEUDO_PANEL, usePseudoRoute } from "../composables/infra/usePseudoRoute";
import {
  buildClosePseudoPanelRoute,
  buildPanelPseudoRoute,
  buildPanelVisibilityPseudoRoute,
  buildSessionPseudoRoute,
  resolveActivePseudoPanel as resolveActivePseudoPanelState,
} from "./payload/appShellRoutePayload";

export { PSEUDO_PANEL };

export function useAppShellPseudoRoute({
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
    const currentIds = [
      activeSessionId?.value,
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
    if (targetPanel === PSEUDO_PANEL.WORKSPACE) openWorkspaceRaw?.();
    if (targetPanel === PSEUDO_PANEL.USER_SETTINGS && isSuperAdmin?.value) openUserSettingsRaw?.();
    if (targetPanel === PSEUDO_PANEL.CONFIG_PARAMS) openConfigParamsRaw?.();
    if (targetPanel === PSEUDO_PANEL.SIDEBAR) openMobileSidebar?.();
    if (targetPanel === PSEUDO_PANEL.COMPOSER && composerMorePanelVisible) composerMorePanelVisible.value = true;
    if (targetPanel === PSEUDO_PANEL.THINKING_DETAILS) openThinkingDetailsPanel?.({ pushRoute: false });
    if (targetPanel === PSEUDO_PANEL.CHAT_NAVIGATOR && isMobile?.value && mobileChatNavigatorVisible) {
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
    resolveCurrentSessionId: () => activeSessionId?.value,
    resolveCurrentPanel: resolveActivePseudoPanel,
    resolveCurrentAnchor: () => currentMessageAnchorId?.value,
    applyRoute: applyPseudoRouteToUi,
  });

  async function handleSelectSession(sessionId, options = {}) {
    const { fromHistory = false, ...selectOptions } = options || {};
    const previousSessionId = String(activeSessionId?.value || "").trim();
    closeMobileSidebarOnSelect?.(isMobile, mobileSidebarOpen);
    await selectSession?.(sessionId, selectOptions);
    const nextSessionId = String(activeSessionId?.value || "").trim();
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
      replacePseudoRoute();
    },
  );

  watch(
    () => activeSessionId?.value,
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

  return {
    initialPseudoRouteApplied,
    parsePseudoRouteFromLocation,
    applyPseudoRoute,
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
