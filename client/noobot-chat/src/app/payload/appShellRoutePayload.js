/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function normalizePseudoRouteValue(value = "") {
  return String(value || "").trim();
}

export function buildSessionPseudoRoute(sessionId = "") {
  return {
    sessionId: normalizePseudoRouteValue(sessionId),
    panel: "",
  };
}

export function buildPanelPseudoRoute(sessionId = "", panel = "") {
  return {
    sessionId: normalizePseudoRouteValue(sessionId),
    panel: normalizePseudoRouteValue(panel),
  };
}

export function buildPanelVisibilityPseudoRoute({ sessionId = "", visible = false, panel = "" } = {}) {
  return buildPanelPseudoRoute(sessionId, visible ? panel : "");
}

export function buildClosePseudoPanelRoute() {
  return { panel: "" };
}

export function resolveActivePseudoPanel({
  workspaceVisible = false,
  userSettingsVisible = false,
  configParamsVisible = false,
  mobileSidebarOpen = false,
  isMobile = false,
  composerMorePanelVisible = false,
  thinkingDetailsVisible = false,
  mobileChatNavigatorVisible = false,
  panels = {},
} = {}) {
  if (workspaceVisible) return panels.WORKSPACE;
  if (userSettingsVisible) return panels.USER_SETTINGS;
  if (configParamsVisible) return panels.CONFIG_PARAMS;
  if (mobileSidebarOpen && isMobile) return panels.SIDEBAR;
  if (composerMorePanelVisible) return panels.COMPOSER;
  if (thinkingDetailsVisible) return panels.THINKING_DETAILS;
  if (mobileChatNavigatorVisible && isMobile) return panels.CHAT_NAVIGATOR;
  return "";
}
