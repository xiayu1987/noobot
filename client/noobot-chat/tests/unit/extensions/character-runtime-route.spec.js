/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { activate } from "../../../../../plugin/noobot-plugin-character/frontend/index.js";
import {
  CHARACTER_ANIMATION_ARTIFACT_TYPE,
  CHARACTER_PLUGIN_ID,
} from "../../../../../plugin/noobot-plugin-character/src/contract.js";
import {
  clearExtensionRegistry,
  contributeExtension,
} from "../../../src/extensions/extension-registry.js";
import { createSendStreamEventHandler } from "../../../src/modules/chat/runtime/engine/sendStreamEventRouter.js";
import { createFixture } from "../modules/chat/helpers/useReconnectReplayHelper.js";

const runtime = vi.hoisted(() => ({
  state: { sessionId: "", cards: [] },
  apply: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("../../../../../plugin/noobot-plugin-character/frontend/runtime/animationState.js", () => ({
  animationRuntimeState: runtime.state,
  applyAnimationRuntimeEvent: runtime.apply,
  resetAnimationRuntimeState: runtime.reset,
}));
vi.mock("../../../../../plugin/noobot-plugin-character/frontend/i18n/index.js", () => ({
  useCharacterLocale: () => ({ translate: (key) => key }),
}));

function artifact(sessionId) {
  return createPluginArtifactEnvelope({
    sessionId,
    turnScopeId: "turn-1",
    pluginId: CHARACTER_PLUGIN_ID,
    artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
    artifactId: "animation-1",
    operation: "created",
    baseRevision: null,
    revision: 1,
    sequence: 1,
    occurredAt: "2026-10-31T18:00:00.000Z",
    data: { title: "animation" },
  });
}

describe("character runtime session routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.state.sessionId = "previous-session";
    runtime.apply.mockReturnValue({ applied: true });
    runtime.reset.mockImplementation((sessionId) => {
      runtime.state.sessionId = sessionId;
    });
  });
  afterEach(() => clearExtensionRegistry());

  it.each(["live", "reconnect"])(
    "%s follows the current active session without applying background artifacts",
    async (source) => {
      const { api, refs } = createFixture();
      await activate({
        pluginMeta: { pluginId: CHARACTER_PLUGIN_ID },
        extensionPoints: EXTENSION_POINTS,
        contributeExtension: (point, contribution) =>
          contributeExtension(point, { ...contribution, pluginId: CHARACTER_PLUGIN_ID }),
        services: { authenticatedRequest: { request: vi.fn() } },
      });
      const live = createSendStreamEventHandler({
        activeSession: refs.activeSession,
        sessionId: "s-1",
        turnScopeId: "turn-1",
        botMessage: {},
        logSessionEvent: vi.fn(),
      });
      const deliver = (envelope) =>
        source === "live"
          ? live({ event: envelope.identity.eventType, data: envelope, channelSessionId: "s-1" })
          : api.applyReconnectEvent(envelope.identity.eventType, envelope);
      const first = artifact("s-1");
      const second = artifact("s-2");

      await deliver(second);
      expect(runtime.apply).not.toHaveBeenCalled();
      expect(runtime.reset).not.toHaveBeenCalled();
      expect(runtime.state.sessionId).toBe("previous-session");

      await deliver(first);
      expect(runtime.apply).toHaveBeenLastCalledWith(first);
      expect(runtime.reset).toHaveBeenLastCalledWith("s-1");

      refs.activeSessionId.value = "s-2";
      await deliver(first);
      expect(runtime.apply).toHaveBeenCalledTimes(1);
      await deliver(second);
      expect(runtime.apply).toHaveBeenLastCalledWith(second);
      expect(runtime.reset).toHaveBeenLastCalledWith("s-2");

      refs.activeSessionId.value = "";
      await deliver(second);
      expect(runtime.apply).toHaveBeenCalledTimes(2);
      expect(runtime.reset.mock.calls).toEqual([["s-1"], ["s-2"]]);
    },
  );
});
