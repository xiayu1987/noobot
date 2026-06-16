import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  PSEUDO_PANEL,
  isSamePseudoRoute,
  normalizePseudoPanel,
  parsePseudoRouteFromLocation,
  usePseudoRoute,
} from "../../../../src/composables/infra/usePseudoRoute";

function resetUrl(url = "/chat") {
  window.history.replaceState({}, "", url);
}

describe("usePseudoRoute", () => {
  beforeEach(() => {
    resetUrl();
    vi.restoreAllMocks();
  });

  it("normalizes and parses pseudo route query", () => {
    resetUrl("/chat?session=s1&panel=workspace&keep=1#top");
    expect(parsePseudoRouteFromLocation()).toEqual({
      sessionId: "s1",
      panel: PSEUDO_PANEL.WORKSPACE,
    });
    expect(normalizePseudoPanel("unknown")).toBe("");
    expect(isSamePseudoRoute({ sessionId: "s1", panel: "workspace" }, { sessionId: "s1", panel: "workspace" })).toBe(true);
  });

  it("pushes a new pseudo route and preserves unrelated query/hash", () => {
    resetUrl("/chat?keep=1#top");
    const router = usePseudoRoute({
      resolveCurrentSessionId: () => "s0",
      resolveCurrentPanel: () => "",
    });

    router.pushPseudoRoute({ sessionId: "s1", panel: PSEUDO_PANEL.COMPOSER });

    expect(window.location.pathname).toBe("/chat");
    expect(window.location.search).toBe("?keep=1&session=s1&panel=composer");
    expect(window.location.hash).toBe("#top");
    expect(window.history.state.noobotPseudoRoute).toEqual({
      sessionId: "s1",
      panel: PSEUDO_PANEL.COMPOSER,
    });
  });

  it("does not push duplicate pseudo route entries", () => {
    resetUrl("/chat?session=s1&panel=composer");
    window.history.replaceState(
      { noobotPseudoRoute: { sessionId: "s1", panel: PSEUDO_PANEL.COMPOSER } },
      "",
      window.location.href,
    );
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const router = usePseudoRoute({
      resolveCurrentSessionId: () => "s1",
      resolveCurrentPanel: () => PSEUDO_PANEL.COMPOSER,
    });

    router.pushPseudoRoute({ sessionId: "s1", panel: PSEUDO_PANEL.COMPOSER });

    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("replaces instead of pushing when URL is same but state is missing", () => {
    resetUrl("/chat?session=s1&panel=composer");
    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const router = usePseudoRoute({
      resolveCurrentSessionId: () => "s1",
      resolveCurrentPanel: () => PSEUDO_PANEL.COMPOSER,
    });

    router.pushPseudoRoute({ sessionId: "s1", panel: PSEUDO_PANEL.COMPOSER });

    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledOnce();
    expect(window.history.state.noobotPseudoRoute).toEqual({
      sessionId: "s1",
      panel: PSEUDO_PANEL.COMPOSER,
    });
  });

  it("applies route on popstate and suppresses writes while applying", async () => {
    const applyRoute = vi.fn(async () => {});
    const router = usePseudoRoute({ applyRoute });

    await router.handlePseudoRoutePopState({
      state: { noobotPseudoRoute: { sessionId: "s2", panel: PSEUDO_PANEL.WORKSPACE } },
    });

    expect(applyRoute).toHaveBeenCalledWith({
      sessionId: "s2",
      panel: PSEUDO_PANEL.WORKSPACE,
    });
  });
});
