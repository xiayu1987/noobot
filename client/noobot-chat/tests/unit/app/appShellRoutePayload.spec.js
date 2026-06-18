import { describe, expect, it } from "vitest";
import {
  buildClosePseudoPanelRoute,
  buildPanelPseudoRoute,
  buildPanelVisibilityPseudoRoute,
  buildSessionPseudoRoute,
  resolveActivePseudoPanel,
} from "../../../src/app/payload/appShellRoutePayload";

describe("appShellRoutePayload", () => {
  const panels = {
    WORKSPACE: "workspace",
    USER_SETTINGS: "user-settings",
    CONFIG_PARAMS: "config-params",
    SIDEBAR: "sidebar",
    COMPOSER: "composer",
    THINKING_DETAILS: "thinking-details",
    CHAT_NAVIGATOR: "chat-navigator",
  };

  it("builds normalized route payloads for sessions and panels", () => {
    expect(buildSessionPseudoRoute(" session-1 ")).toEqual({ sessionId: "session-1", panel: "" });
    expect(buildPanelPseudoRoute(" session-1 ", panels.WORKSPACE)).toEqual({ sessionId: "session-1", panel: panels.WORKSPACE });
    expect(buildClosePseudoPanelRoute()).toEqual({ panel: "" });
  });

  it("builds visibility based panel routes", () => {
    expect(buildPanelVisibilityPseudoRoute({ sessionId: "s1", visible: true, panel: panels.SIDEBAR })).toEqual({ sessionId: "s1", panel: panels.SIDEBAR });
    expect(buildPanelVisibilityPseudoRoute({ sessionId: "s1", visible: false, panel: panels.SIDEBAR })).toEqual({ sessionId: "s1", panel: "" });
  });

  it("resolves the active pseudo panel by existing priority", () => {
    expect(resolveActivePseudoPanel({ workspaceVisible: true, composerMorePanelVisible: true, panels })).toBe(panels.WORKSPACE);
    expect(resolveActivePseudoPanel({ mobileSidebarOpen: true, isMobile: false, panels })).toBe("");
    expect(resolveActivePseudoPanel({ mobileSidebarOpen: true, isMobile: true, panels })).toBe(panels.SIDEBAR);
    expect(resolveActivePseudoPanel({ mobileChatNavigatorVisible: true, isMobile: true, panels })).toBe(panels.CHAT_NAVIGATOR);
    expect(resolveActivePseudoPanel({ mobileChatNavigatorVisible: true, isMobile: false, panels })).toBe("");
  });
});
