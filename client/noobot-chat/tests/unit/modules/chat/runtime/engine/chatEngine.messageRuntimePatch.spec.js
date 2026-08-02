/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { projectTurnRuntimeToMessages } from "../../../../../../src/modules/chat/runtime/engine/turnProjectionStore.js";
import { applyTurnRuntimeEvent, createTurnRuntimeRegistryState } from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";

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

    projectTurnRuntimeToMessages({ sessions, turnRuntimeRegistry, turn: event });

    expect(aMessage.channelState).toBeUndefined();
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

    projectTurnRuntimeToMessages({
      sessions,
      turnRuntimeRegistry,
      turn: { sessionId: "b", turnScopeId: "ta", dialogProcessId: "da" },
    });

    expect(message.channelState).toBeUndefined();
  });
});
