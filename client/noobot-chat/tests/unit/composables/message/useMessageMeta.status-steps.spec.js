/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import { useMessageMeta } from "../../../../src/composables/message/useMessageMeta";
import { useChatStore } from "../../../../src/shared/stores/useChatStore";
import { applyTurnRuntimeEvent } from "../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";
import { SESSION_RUN_EVENT } from "../../../../src/composables/chat/sessionRunStateMachine/constants";

function applyEvent(store, event) {
  applyTurnRuntimeEvent(store.turnRuntimeRegistry, event);
}

describe("useMessageMeta status steps", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useChatStore().resetChatStore();
  });

  it("reacts to Registry state transitions for the placeholder turn", async () => {
    const store = useChatStore();
    const message = { role: "assistant", turnPlaceholder: true, turnScopeId: "turn-1" };
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message });

    expect(statusStepState.value).toBe("");
    applyEvent(store, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "session-1",
      turnScopeId: "turn-1",
    });
    await nextTick();
    expect(statusStepState.value).toBe("requesting");

    applyEvent(store, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "session-1",
      turnScopeId: "turn-1",
    });
    await nextTick();
    expect(statusStepState.value).toBe("sending");

    applyEvent(store, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      sessionId: "session-1",
      turnScopeId: "turn-1",
    });
    await nextTick();
    expect(statusStepState.value).toBe("stopping");

    applyEvent(store, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
      sessionId: "session-1",
      turnScopeId: "turn-1",
    });
    await nextTick();
    expect(statusStepState.value).toBe("stopped");
  });

  it("follows turn identity rather than message order, object lifetime, or active Session", async () => {
    const store = useChatStore();
    const message = ref({ role: "assistant", turnPlaceholder: true, turnScopeId: "turn-a" });
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message.value });

    applyEvent(store, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "session-a",
      turnScopeId: "turn-a",
    });
    applyEvent(store, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "session-b",
      turnScopeId: "turn-b",
    });
    store.activeSessionId = "session-b";
    await nextTick();
    expect(statusStepState.value).toBe("sending");

    message.value = { role: "assistant", turnPlaceholder: true, turnScopeId: "turn-b" };
    await nextTick();
    expect(statusStepState.value).toBe("requesting");

    message.value = { role: "assistant", turnPlaceholder: true, turnScopeId: "unknown-turn" };
    await nextTick();
    expect(statusStepState.value).toBe("");
  });

  it("uses the persisted main-turn display identity without replacing an internal turn", async () => {
    const store = useChatStore();
    const message = {
      role: "assistant",
      turnScopeId: "internal-turn:child",
      statusTurnScopeId: "client-turn:main",
    };
    applyEvent(store, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "session-1",
      turnScopeId: "client-turn:main",
      terminal: "completed",
    });
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message });
    await nextTick();
    expect(statusStepState.value).toBe("completed");
    expect(message.turnScopeId).toBe("internal-turn:child");
  });

  it("restores a persisted status before Registry hydration after refresh", async () => {
    const message = {
      role: "assistant",
      turnScopeId: "internal-turn:child",
      statusTurnScopeId: "client-turn:main",
      persistedStatusStepState: "completed",
    };
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message });
    await nextTick();
    expect(statusStepState.value).toBe("completed");
  });
});
