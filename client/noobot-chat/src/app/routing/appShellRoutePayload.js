/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

function normalizePseudoRouteValue(value = "") {
  return text(value);
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
