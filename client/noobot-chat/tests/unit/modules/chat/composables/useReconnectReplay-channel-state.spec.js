/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { createFixture, createCanonicalAssistant } from "../helpers/useReconnectReplayHelper.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

async function applyTransportState(api, overrides = {}) {
  return api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
    sessionId: "s-1",
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    state: "sending",
    ...overrides,
  });
}

describe("useReconnectReplay channel_state contract", () => {
  it("treats channel_state as transport-only", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ sessionId: "s-1", dialogProcessId: "dp-1", turnScopeId: "turn-1" }),
    ];
    const before = JSON.parse(JSON.stringify(refs.activeSession.value.messages));

    const result = await applyTransportState(api);

    expect(result).toMatchObject({ applied: false, reason: "transport_channel_state_ignored" });
    expect(refs.activeSession.value.messages).toEqual(before);
    expect(Object.keys(refs.turnRuntimeRegistry.value.turns || {})).toHaveLength(0);
  });

  it.each(["sending", "reconnecting", "stopping", "completed", "user_stopped", "error"])(
    "does not project %s into Turn authority or message state",
    async (state) => {
      const { api, refs, mocks } = createFixture();
      refs.activeSession.value.messages = [
        { role: RoleEnum.USER, content: "q" },
        createCanonicalAssistant({ sessionId: "s-1", dialogProcessId: "dp-1", turnScopeId: "turn-1" }),
      ];
      const before = JSON.parse(JSON.stringify(refs.activeSession.value.messages));

      const result = await applyTransportState(api, { state });

      expect(result).toMatchObject({ applied: false, reason: "transport_channel_state_ignored" });
      expect(refs.activeSession.value.messages).toEqual(before);
      expect(mocks.applyTurnRuntimeEvents).not.toHaveBeenCalled();
      expect(mocks.resolveTurnTerminalState).not.toHaveBeenCalled();
      expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
    },
  );

  it("does not infer a message from a channel state without message identity", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];
    const result = await applyTransportState(api, {
      dialogProcessId: "",
      turnScopeId: "",
      messageId: "",
      state: "sending",
    });

    expect(result).toMatchObject({ applied: false, reason: "transport_channel_state_ignored" });
    expect(refs.activeSession.value.messages).toHaveLength(1);
    expect(mocks.findCanonicalMessageById).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("does not use channel timestamps as timing facts", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ sessionId: "s-1", dialogProcessId: "dp-1", turnScopeId: "turn-1" }),
    ];

    await applyTransportState(api, {
      updatedAt: "2026-06-22T10:00:00.000Z",
      updatedAtMs: 1782122400000,
    });

    expect(refs.activeSession.value.messages[1].thinkingStartedAt).toBeUndefined();
    expect(refs.activeSession.value.messages[1].timing).toBeUndefined();
  });

  it("does not let stale or terminal channel state affect a newer turn", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "new", turnScopeId: "turn-new" },
      createCanonicalAssistant({ sessionId: "s-1", dialogProcessId: "dp-new", turnScopeId: "turn-new", pending: true }),
    ];

    const result = await applyTransportState(api, {
      dialogProcessId: "dp-old",
      turnScopeId: "turn-old",
      state: "user_stopped",
    });

    expect(result).toMatchObject({ applied: false, reason: "transport_channel_state_ignored" });
    expect(refs.activeSession.value.messages[1].pending).toBe(true);
    expect(refs.activeSession.value.messages[1].turnScopeId).toBe("turn-new");
    expect(mocks.resolveTurnTerminalState).not.toHaveBeenCalled();
  });
});
