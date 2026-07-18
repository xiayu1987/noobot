/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { applyRunStateMessageRuntimePatch } from "../../../../src/composables/chat/chatEngine/messageRuntimePatch";
import { applyTurnRuntimeEvent, createTurnRuntimeRegistryState } from "../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../src/composables/chat/sessionRunStateMachine/constants";

describe("chatEngine message runtime patch isolation", () => {
  it("patches the event's background session and matching turn only", () => {
    const aMessage = { role: "assistant", pending: true, turnScopeId: "ta", dialogProcessId: "da" };
    const otherTurn = { role: "assistant", pending: true, turnScopeId: "old", dialogProcessId: "old-dialog" };
    const bMessage = { role: "assistant", pending: true, turnScopeId: "tb", dialogProcessId: "db" };
    const sessions = ref([
      { id: "a", messages: [aMessage, otherTurn] },
      { id: "b", messages: [bMessage] },
    ]);
    const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
    const event = {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: BackendChannelState.SENDING,
      sessionId: "a",
      turnScopeId: "ta",
      dialogProcessId: "da",
      seq: 1,
    };
    applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "a",
      turnScopeId: "ta",
      dialogProcessId: "da",
    });
    applyTurnRuntimeEvent(turnRuntimeRegistry.value, event);

    applyRunStateMessageRuntimePatch({ sessions, turnRuntimeRegistry, event });

    expect(aMessage.channelState?.state).toBe(BackendChannelState.SENDING);
    expect(otherTurn.channelState).toBeUndefined();
    expect(bMessage.channelState).toBeUndefined();
  });

  it("does nothing when event identity conflicts with the owning turn", () => {
    const message = { role: "assistant", pending: true, turnScopeId: "ta", dialogProcessId: "da" };
    const sessions = ref([{ id: "a", messages: [message] }]);
    const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());
    applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "a",
      turnScopeId: "ta",
      dialogProcessId: "da",
    });
    applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: BackendChannelState.SENDING,
      sessionId: "a",
      turnScopeId: "ta",
      dialogProcessId: "da",
    });

    applyRunStateMessageRuntimePatch({
      sessions,
      turnRuntimeRegistry,
      event: { sessionId: "b", turnScopeId: "ta", dialogProcessId: "da" },
    });

    expect(message.channelState).toBeUndefined();
  });
});
