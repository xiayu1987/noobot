/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PSEUDO_PANEL } from "./useAppShellPseudoRoute";
import { updateDrawerModelVisibility } from "./appShellEventHandlers";

export function useAppShellPanelActions({
  activeSessionId,
  userId,
  apiRole,
  isSuperAdmin,
  isMobile,
  mobileSidebarOpen,
  composerMorePanelVisible,
  ensureConnected,
  notify,
  translate = (key) => key,
  closeAllDrawers,
  toggleSidebar,
  closeMobileSidebar,
  openWorkspaceRaw,
  openUserSettingsRaw,
  openConfigParamsRaw,
  pushPanelPseudoRoute,
  pushPanelVisibilityPseudoRoute,
  pushClosePseudoPanelRoute,
} = {}) {
  function closeComposerMorePanel() {
    if (composerMorePanelVisible) composerMorePanelVisible.value = false;
  }

  function openWorkspace() {
    if (!ensureConnected?.()) return;
    if (!userId?.value?.trim()) {
      notify?.({ type: "warning", message: translate("common.userIdRequired") });
      return;
    }
    closeComposerMorePanel();
    openWorkspaceRaw?.();
    pushPanelPseudoRoute?.(activeSessionId?.value, PSEUDO_PANEL.WORKSPACE);
  }

  async function openUserSettings() {
    if (!ensureConnected?.()) return;
    if (!isSuperAdmin?.value) {
      const currentRole = String(apiRole?.value || "user").trim() || "user";
      notify?.({
        type: "warning",
        message: `${translate("common.superAdminOnly")} (role=${currentRole})`,
      });
      return;
    }
    closeComposerMorePanel();
    openUserSettingsRaw?.();
    pushPanelPseudoRoute?.(activeSessionId?.value, PSEUDO_PANEL.USER_SETTINGS);
  }

  function openConfigParams() {
    if (!ensureConnected?.()) return;
    closeComposerMorePanel();
    openConfigParamsRaw?.();
    pushPanelPseudoRoute?.(activeSessionId?.value, PSEUDO_PANEL.CONFIG_PARAMS);
  }

  function handleToggleSidebar() {
    toggleSidebar?.();
    if (isMobile?.value) {
      if (mobileSidebarOpen?.value) closeComposerMorePanel();
      pushPanelVisibilityPseudoRoute?.({
        sessionId: activeSessionId?.value,
        visible: mobileSidebarOpen?.value,
        panel: PSEUDO_PANEL.SIDEBAR,
      });
    }
  }

  function handleCloseMobileSidebar() {
    closeMobileSidebar?.();
    pushClosePseudoPanelRoute?.();
  }

  function handleComposerMorePanelVisibleUpdate(value) {
    const nextVisible = Boolean(value);
    if (composerMorePanelVisible?.value === nextVisible) return;
    if (nextVisible) {
      closeAllDrawers?.();
      closeMobileSidebar?.();
    }
    if (composerMorePanelVisible) composerMorePanelVisible.value = nextVisible;
    pushPanelVisibilityPseudoRoute?.({
      sessionId: activeSessionId?.value,
      visible: nextVisible,
      panel: PSEUDO_PANEL.COMPOSER,
    });
  }

  function handleDrawerModelUpdate(drawer = {}, value = false) {
    const { closed } = updateDrawerModelVisibility({ drawer, value });
    if (closed) pushClosePseudoPanelRoute?.();
  }

  return {
    closeComposerMorePanel,
    openWorkspace,
    openUserSettings,
    openConfigParams,
    handleToggleSidebar,
    handleCloseMobileSidebar,
    handleComposerMorePanelVisibleUpdate,
    handleDrawerModelUpdate,
  };
}
