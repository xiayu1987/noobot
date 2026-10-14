/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizePseudoRouteValue(value = "") {
  return String(value || "").trim();
}

export function buildSessionPseudoRoute(sessionId = "") {
  return {
    sessionId: normalizePseudoRouteValue(sessionId),
    panel: "",
  };
}

export function buildClosePseudoPanelRoute() {
  return { panel: "" };
}
