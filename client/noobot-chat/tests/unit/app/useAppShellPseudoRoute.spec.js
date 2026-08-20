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
  const openConnectorsRaw = vi.fn(() => {
    connectorVisible.value = true;
  });
  const route = useAppShellPseudoRoute({
    activeSessionId,
    activeSession,
    currentMessageAnchorId: ref(""),
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
    closeAllDrawers: vi.fn(),
    closeMobileSidebar: vi.fn(),
    closeComposerMorePanel: vi.fn(),
    closeThinkingDetailsPanel: vi.fn(),
    openConnectorsRaw,
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

  it("applies the initial Session route exactly once from the connected entrypoint", async () => {
    const { route, selectSession } = createRouteHarness();
    const requested = { sessionId: "persisted-session", panel: "", anchor: "" };
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

    await route.applyInitialPseudoRoute({ sessionId: "", panel: "", anchor: "" });

    expect(new URL(window.location.href).searchParams.has("session")).toBe(false);
  });

  it("collapses the default navigator when restoring the connector overview", async () => {
    const { route, connectorVisible, chatNavigatorVisible, openConnectorsRaw } =
      createRouteHarness();

    await route.applyInitialPseudoRoute({
      sessionId: "local-session",
      panel: "connectors",
      anchor: "",
    });

    expect(chatNavigatorVisible.value).toBe(false);
    expect(connectorVisible.value).toBe(true);
    expect(openConnectorsRaw).toHaveBeenCalledTimes(1);
  });
});
