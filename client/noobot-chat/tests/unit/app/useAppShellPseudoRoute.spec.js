/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useAppShellPseudoRoute } from "../../../src/app/composables/useAppShellPseudoRoute.js";

function createRouteHarness() {
  const activeSessionId = ref("local-session");
  const activeSession = ref({ sessionId: "local-session", loaded: true });
  const selectSession = vi.fn(async (sessionId) => {
    activeSessionId.value = sessionId;
    activeSession.value = { sessionId, loaded: true };
  });
  const connectorVisible = ref(false);
  const chatNavigatorVisible = ref(true);
  const routedTurnScopeId = ref("");
  const applyRoutedTurn = vi.fn(({ turnScopeId }) => {
    routedTurnScopeId.value = turnScopeId;
  });
  const requestSessionNavigation = vi.fn();
  const openConnectorsRaw = vi.fn(() => {
    connectorVisible.value = true;
  });
  const route = useAppShellPseudoRoute({
    activeSessionId,
    activeSession,
    routedTurnScopeId,
    applyRoutedTurn,
    requestSessionNavigation,
    workspaceVisible: ref(false),
    connectorVisible,
    userSettingsVisible: ref(false),
    configParamsVisible: ref(false),
    mobileSidebarOpen: ref(false),
    isMobile: ref(false),
    composerMorePanelVisible: ref(false),
    thinkingDetailsVisible: ref(false),
    mobileChatNavigatorVisible: ref(false),
    chatNavigatorVisible,
    isSuperAdmin: ref(false),
    closeAllPanels: vi.fn(),
    closeMobileSidebar: vi.fn(),
    closeComposerMorePanel: vi.fn(),
    closeThinkingDetailsPanel: vi.fn(),
    openConnectorsRaw,
    openWorkspaceRaw: vi.fn(),
    openUserSettingsRaw: vi.fn(),
    openConfigParamsRaw: vi.fn(),
    openMobileSidebar: vi.fn(),
    openThinkingDetailsPanel: vi.fn(),
    closeMobileSidebarOnSelect: vi.fn(),
    selectSession,
  });
  return {
    route,
    selectSession,
    activeSessionId,
    activeSession,
    connectorVisible,
    chatNavigatorVisible,
    openConnectorsRaw,
    applyRoutedTurn,
    requestSessionNavigation,
  };
}

describe("useAppShellPseudoRoute initial Session activation", () => {
  it("does not consume the requested Session before connection data is ready", async () => {
    window.history.replaceState({}, "", "/?session=requested-session");
    const { route, selectSession, activeSessionId, activeSession } = createRouteHarness();
    activeSessionId.value = "another-local-session";
    activeSession.value = { sessionId: "another-local-session", loaded: true };
    await nextTick();
    expect(selectSession).not.toHaveBeenCalled();
    expect(route.initialPseudoRouteApplied.value).toBe(false);
    expect(new URL(window.location.href).searchParams.get("session")).toBe("requested-session");
  });

  it("preserves an unapplied Session deep link when opening the mobile sidebar", () => {
    window.history.replaceState({}, "", "/?session=requested-session");
    const { route } = createRouteHarness();

    route.pushPanelVisibilityPseudoRoute({ visible: true, panel: "sidebar" });

    expect(new URL(window.location.href).searchParams.get("session")).toBe("requested-session");
    expect(new URL(window.location.href).searchParams.get("panel")).toBe("sidebar");
  });

  it("applies the initial Session route exactly once from the connected entrypoint", async () => {
    const { route, selectSession } = createRouteHarness();
    const requested = { sessionId: "persisted-session", panel: "", turn: "" };
    await expect(route.applyInitialPseudoRoute(requested)).resolves.toBe(true);
    await expect(route.applyInitialPseudoRoute(requested)).resolves.toBe(false);
    expect(selectSession).toHaveBeenCalledTimes(1);
    expect(selectSession).toHaveBeenCalledWith("persisted-session", {
      force: true,
      silent: true,
    });
  });

  it("does not publish a local unprovisioned Session as a recoverable URL", async () => {
    window.history.replaceState({}, "", "/?session=stale-local-session");
    const { route, activeSessionId, activeSession } = createRouteHarness();
    activeSessionId.value = "local-session";
    activeSession.value = { sessionId: "local-session", isLocal: true, loaded: true };

    await route.applyInitialPseudoRoute({ sessionId: "", panel: "", turn: "" });

    expect(new URL(window.location.href).searchParams.has("session")).toBe(false);
  });

  it("publishes the Session URL once the local Session is provisioned in place", async () => {
    window.history.replaceState({}, "", "/");
    const { route, activeSessionId, activeSession } = createRouteHarness();
    activeSessionId.value = "local-session";
    activeSession.value = { sessionId: "local-session", isLocal: true, loaded: true };
    await route.applyInitialPseudoRoute({ sessionId: "", panel: "", turn: "" });
    expect(new URL(window.location.href).searchParams.has("session")).toBe(false);

    activeSession.value.isLocal = false;
    await nextTick();

    expect(new URL(window.location.href).searchParams.get("session")).toBe("local-session");
  });

  it("collapses the default navigator when restoring the connector overview", async () => {
    const { route, connectorVisible, chatNavigatorVisible, openConnectorsRaw } =
      createRouteHarness();

    await route.applyInitialPseudoRoute({
      sessionId: "local-session",
      panel: "connectors",
      turn: "",
    });

    expect(chatNavigatorVisible.value).toBe(false);
    expect(connectorVisible.value).toBe(true);
    expect(openConnectorsRaw).toHaveBeenCalledTimes(1);
  });

  it("registers the URL turn before selecting the routed Session", async () => {
    const { route, selectSession, applyRoutedTurn, requestSessionNavigation } =
      createRouteHarness();
    const turn = "client-turn:00000000-0000-4000-8000-000000000009";

    await route.applyInitialPseudoRoute({ sessionId: "persisted-session", panel: "", turn });

    expect(applyRoutedTurn).toHaveBeenCalledWith({
      sessionId: "persisted-session",
      turnScopeId: turn,
    });
    expect(applyRoutedTurn).toHaveBeenCalledBefore(selectSession);

    expect(requestSessionNavigation).not.toHaveBeenCalled();
    expect(new URL(window.location.href).searchParams.get("turn")).toBe(turn);
  });

  it("requests Session navigation when the routed Session is already active", async () => {
    const { route, selectSession, requestSessionNavigation } = createRouteHarness();
    const turn = "client-turn:00000000-0000-4000-8000-000000000010";

    await route.applyInitialPseudoRoute({ sessionId: "local-session", panel: "", turn });

    expect(selectSession).not.toHaveBeenCalled();
    expect(requestSessionNavigation).toHaveBeenCalledWith("local-session");
  });
});
