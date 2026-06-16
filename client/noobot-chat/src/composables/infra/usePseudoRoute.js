/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref } from "vue";

export const PSEUDO_ROUTE_SESSION_KEY = "session";
export const PSEUDO_ROUTE_PANEL_KEY = "panel";

export const PSEUDO_PANEL = Object.freeze({
  WORKSPACE: "workspace",
  USER_SETTINGS: "user-settings",
  CONFIG_PARAMS: "config-params",
  SIDEBAR: "sidebar",
  COMPOSER: "composer",
});

const DEFAULT_ALLOWED_PANELS = new Set(Object.values(PSEUDO_PANEL));

function hasOwn(object = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getSafeWindow() {
  return typeof window === "undefined" ? null : window;
}

function getSafeHistory() {
  return typeof history === "undefined" ? null : history;
}

export function normalizePseudoPanel(panel = "", allowedPanels = DEFAULT_ALLOWED_PANELS) {
  const value = String(panel || "").trim();
  const allowedSet = allowedPanels instanceof Set ? allowedPanels : new Set(allowedPanels || []);
  return allowedSet.has(value) ? value : "";
}

export function normalizePseudoRoute(route = {}, { allowedPanels = DEFAULT_ALLOWED_PANELS } = {}) {
  return {
    sessionId: String(route?.sessionId || "").trim(),
    panel: normalizePseudoPanel(route?.panel || "", allowedPanels),
  };
}

export function isSamePseudoRoute(left = {}, right = {}, options = {}) {
  const normalizedLeft = normalizePseudoRoute(left, options);
  const normalizedRight = normalizePseudoRoute(right, options);
  return (
    normalizedLeft.sessionId === normalizedRight.sessionId &&
    normalizedLeft.panel === normalizedRight.panel
  );
}

export function parsePseudoRouteFromLocation(locationObject = getSafeWindow()?.location, options = {}) {
  const params = new URLSearchParams(locationObject?.search || "");
  return normalizePseudoRoute(
    {
      sessionId: params.get(PSEUDO_ROUTE_SESSION_KEY),
      panel: params.get(PSEUDO_ROUTE_PANEL_KEY),
    },
    options,
  );
}

export function usePseudoRoute({
  allowedPanels = DEFAULT_ALLOWED_PANELS,
  resolveCurrentSessionId = () => "",
  resolveCurrentPanel = () => "",
  applyRoute = async () => {},
} = {}) {
  const allowedPanelSet = allowedPanels instanceof Set ? allowedPanels : new Set(allowedPanels || []);
  const applyingPseudoHistory = ref(false);
  const initialPseudoRouteApplied = ref(false);

  function normalizeRoute(route = {}) {
    return normalizePseudoRoute(route, { allowedPanels: allowedPanelSet });
  }

  function parseFromLocation(locationObject = getSafeWindow()?.location) {
    return parsePseudoRouteFromLocation(locationObject, { allowedPanels: allowedPanelSet });
  }

  function resolveActiveRoute() {
    return normalizeRoute({
      sessionId: resolveCurrentSessionId(),
      panel: resolveCurrentPanel(),
    });
  }

  function buildRouteFromCurrentState(patch = {}) {
    const currentRoute = resolveActiveRoute();
    return normalizeRoute({
      sessionId: hasOwn(patch, "sessionId") ? patch.sessionId : currentRoute.sessionId,
      panel: hasOwn(patch, "panel") ? patch.panel : currentRoute.panel,
    });
  }

  function buildUrlForRoute(route = {}, locationObject = getSafeWindow()?.location) {
    const nextRoute = normalizeRoute(route);
    const params = new URLSearchParams(locationObject?.search || "");
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
    return `${locationObject?.pathname || "/"}${query ? `?${query}` : ""}${locationObject?.hash || ""}`;
  }

  function writePseudoRouteHistory(route = {}, { mode = "replace" } = {}) {
    const windowObject = getSafeWindow();
    const historyObject = getSafeHistory();
    if (!windowObject || !historyObject) return;

    const nextRoute = buildRouteFromCurrentState(route);
    const nextUrl = buildUrlForRoute(nextRoute, windowObject.location);
    const currentUrl = `${windowObject.location.pathname}${windowObject.location.search || ""}${windowObject.location.hash || ""}`;
    const currentPseudoRoute =
      historyObject.state && typeof historyObject.state === "object"
        ? historyObject.state.noobotPseudoRoute
        : null;
    const nextState = {
      ...(historyObject.state && typeof historyObject.state === "object" ? historyObject.state : {}),
      noobotPseudoRoute: nextRoute,
    };

    if (
      nextUrl === currentUrl &&
      currentPseudoRoute &&
      typeof currentPseudoRoute === "object" &&
      isSamePseudoRoute(currentPseudoRoute, nextRoute, { allowedPanels: allowedPanelSet })
    ) {
      return;
    }

    if (mode === "push") {
      if (nextUrl === currentUrl) {
        historyObject.replaceState(nextState, "", nextUrl);
        return;
      }
      historyObject.pushState(nextState, "", nextUrl);
      return;
    }

    historyObject.replaceState(nextState, "", nextUrl);
  }

  async function applyPseudoRoute(route = {}) {
    const nextRoute = normalizeRoute(route);
    applyingPseudoHistory.value = true;
    try {
      await applyRoute(nextRoute);
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

  async function handlePseudoRoutePopState(event) {
    const routeFromState =
      event?.state && typeof event.state === "object" ? event.state.noobotPseudoRoute : null;
    const route = routeFromState && typeof routeFromState === "object"
      ? normalizeRoute(routeFromState)
      : parseFromLocation();
    await applyPseudoRoute(route);
  }

  function addPseudoRoutePopStateListener() {
    getSafeWindow()?.addEventListener?.("popstate", handlePseudoRoutePopState);
  }

  function removePseudoRoutePopStateListener() {
    getSafeWindow()?.removeEventListener?.("popstate", handlePseudoRoutePopState);
  }

  return {
    applyingPseudoHistory,
    initialPseudoRouteApplied,
    normalizeRoute,
    parsePseudoRouteFromLocation: parseFromLocation,
    buildRouteFromCurrentState,
    writePseudoRouteHistory,
    applyPseudoRoute,
    pushPseudoRoute,
    replacePseudoRoute,
    handlePseudoRoutePopState,
    addPseudoRoutePopStateListener,
    removePseudoRoutePopStateListener,
  };
}
