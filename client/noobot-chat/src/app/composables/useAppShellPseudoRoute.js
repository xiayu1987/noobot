/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { watch } from "vue";
import { PSEUDO_PANEL, usePseudoRoute } from "../../shared/composables/usePseudoRoute.js";
import {
  buildClosePseudoPanelRoute,
  buildSessionPseudoRoute,
} from "../routing/appShellRoutePayload.js";
import { requireFunctionDependencies, text } from "@noobot/shared/value";

export { PSEUDO_PANEL };

export function useAppShellPseudoRoute({
  activeSessionId,
  activeSession,
  routedTurnScopeId,
  applyRoutedTurn,
  requestSessionNavigation,
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
  closeAllPanels,
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
}) {
  requireFunctionDependencies("useAppShellPseudoRoute", {
    closeAllPanels,
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
    applyRoutedTurn,
    requestSessionNavigation,
  });

  function closeAllPseudoPanels() {
    closeAllPanels();
    closeMobileSidebar();
    closeComposerMorePanel();
    closeThinkingDetailsPanel();
    mobileChatNavigatorVisible.value = false;
  }

  const panelRegistry = [
    {
      panel: PSEUDO_PANEL.WORKSPACE,
      isOpen: () => workspaceVisible.value,
      open: () => openWorkspaceRaw(),
    },
    {
      panel: PSEUDO_PANEL.CONNECTORS,
      isOpen: () => connectorVisible.value,
      open: () => {
        chatNavigatorVisible.value = false;
        openConnectorsRaw();
      },
    },
    {
      panel: PSEUDO_PANEL.USER_SETTINGS,
      isOpen: () => userSettingsVisible.value,
      open: () => {
        if (isSuperAdmin.value) openUserSettingsRaw();
      },
    },
    {
      panel: PSEUDO_PANEL.CONFIG_PARAMS,
      isOpen: () => configParamsVisible.value,
      open: () => openConfigParamsRaw(),
    },
    {
      panel: PSEUDO_PANEL.SIDEBAR,
      isOpen: () => mobileSidebarOpen.value && isMobile.value,
      open: () => openMobileSidebar(),
    },
    {
      panel: PSEUDO_PANEL.COMPOSER,
      isOpen: () => composerMorePanelVisible.value,
      open: () => {
        composerMorePanelVisible.value = true;
      },
    },
    {
      panel: PSEUDO_PANEL.THINKING_DETAILS,
      isOpen: () => thinkingDetailsVisible.value,
      open: () => openThinkingDetailsPanel({ pushRoute: false }),
    },
    {
      panel: PSEUDO_PANEL.CHAT_NAVIGATOR,
      isOpen: () => mobileChatNavigatorVisible.value && isMobile.value,
      open: () => {
        if (isMobile.value) mobileChatNavigatorVisible.value = true;
      },
    },
  ];

  function resolveActivePseudoPanel() {
    const openEntry = panelRegistry.find((entry) => entry.isOpen());
    return openEntry === undefined ? "" : openEntry.panel;
  }

  function isLoadedActiveSessionRouteTarget(sessionId = "") {
    const targetSessionId = text(sessionId);
    const currentSession = activeSession.value;
    if (!targetSessionId || currentSession === null || !currentSession.loaded) return false;
    const currentIds = [activeSessionId.value, currentSession.sessionId]
      .map((value) => text(value))
      .filter(Boolean);
    return currentIds.includes(targetSessionId);
  }

  function resolveRoutableSessionId() {
    const currentSession = activeSession.value;
    if (currentSession !== null && currentSession.isLocal === true) return "";
    return text(activeSessionId.value);
  }

  async function applyPseudoRouteToUi(route) {
    const targetSessionId = text(route.sessionId);
    const targetPanel = text(route.panel);
    closeAllPseudoPanels();

    applyRoutedTurn({ sessionId: targetSessionId, turnScopeId: text(route.turn) });
    if (targetSessionId && !isLoadedActiveSessionRouteTarget(targetSessionId)) {
      await handleSelectSession(targetSessionId, {
        fromHistory: true,
        force: true,
        silent: true,
      });
    } else if (activeSessionId.value) {
      requestSessionNavigation(activeSessionId.value);
    }
    if (targetPanel !== "") {
      const targetEntry = panelRegistry.find((entry) => entry.panel === targetPanel);
      if (targetEntry === undefined) {
        throw new Error(`pseudo route targets unregistered panel: ${targetPanel}`);
      }
      targetEntry.open();
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
    resolveCurrentTurn: () => routedTurnScopeId.value,
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
    const { fromHistory = false, ...selectOptions } = options;
    const previousSessionId = text(activeSessionId.value);
    closeMobileSidebarOnSelect(isMobile, mobileSidebarOpen);
    await selectSession(sessionId, selectOptions);
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

  function pushPanelPseudoRoute(panel = "") {
    pushPseudoRoute({ panel });
  }

  function pushPanelVisibilityPseudoRoute({ visible, panel }) {
    pushPseudoRoute({ panel: visible ? panel : "" });
  }

  function pushClosePseudoPanelRoute() {
    pushPseudoRoute(buildClosePseudoPanelRoute());
  }

  watch([resolveRoutableSessionId, resolveActivePseudoPanel], () => {
    if (!initialPseudoRouteApplied.value) return;
    replacePseudoRoute();
  });

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
