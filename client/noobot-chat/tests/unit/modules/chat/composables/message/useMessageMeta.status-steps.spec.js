/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import { useMessageMeta } from "../../../../../../src/modules/chat/composables/message/useMessageMeta.js";
import { useChatStore } from "../../../../../../src/modules/chat/stores/useChatStore.js";
import { applyTurnLifecycleEnvelope, applyTurnRuntimeEvent, applyTurnTerminalResolution } from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { createTurnLifecycleEnvelope, createTurnTerminalResolution } from "@noobot/session-protocol";

function applyEvent(store, event) {
  applyTurnRuntimeEvent(store.turnRuntimeRegistry, event);
}

function applyLifecycle(store, {
  eventType,
  sessionId,
  turnScopeId,
  revision,
  phase,
  state,
  action = "send",
  executionState,
  canStop = false,
}) {
  return applyTurnLifecycleEnvelope(store.turnRuntimeRegistry, createTurnLifecycleEnvelope({
    eventType,
    eventId: `${eventType}:${sessionId}:${turnScopeId}:${revision}`,
    commandId: `${action}:${turnScopeId}`,
    userId: "u-1",
    sessionId,
    turnScopeId,
    messageId: `event-message:${turnScopeId}`,
    presentationMessageId: `message:${turnScopeId}`,
    revision,
    sequence: revision,
    phase,
    state,
    action,
    executionState,
    capabilities: { actionLocked: true, canStop },
  }));
}

function startAuthorityProcessing(store, sessionId, turnScopeId) {
  applyLifecycle(store, {
    eventType: "turn.action_accepted", sessionId, turnScopeId, revision: 1,
    phase: "action", state: "action_requesting", executionState: "accepted",
  });
  applyLifecycle(store, {
    eventType: "turn.processing_started", sessionId, turnScopeId, revision: 2,
    phase: "processing", state: "processing", executionState: "sending", canStop: true,
  });
}

function settleTurn(store, { sessionId, turnScopeId, state }) {
  const revision = 100;
  const completionCommitId = `commit-${turnScopeId}-${state}`;
  return applyTurnTerminalResolution(store.turnRuntimeRegistry, createTurnTerminalResolution({
    commandId: `resolve-${turnScopeId}-${state}`,
    sessionId,
    turnScopeId,
    resolved: true,
    aggregateVersion: 1,
    turn: { sessionId, turnScopeId, state, phase: state === "stop_completed" ? "stop" : "completion",
      revision, sequence: revision, completionCommitId, summaryVersion: revision,
      capabilities: { actionLocked: false, canStop: false } },
    materialization: { completionCommitId, summaryVersion: revision, revision, sequence: revision,
      terminalStatus: { status: state }, messages: [] },
  }));
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
    startAuthorityProcessing(store, "session-1", "turn-1");
    await nextTick();
    expect(statusStepState.value).toBe("sending");

    applyEvent(store, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      sessionId: "session-1",
      turnScopeId: "turn-1",
    });
    await nextTick();
    expect(statusStepState.value).toBe("stopping");

    applyLifecycle(store, {
      eventType: "turn.stop_accepted", sessionId: "session-1", turnScopeId: "turn-1",
      revision: 3, phase: "stop", state: "action_requesting", action: "stop", executionState: "stopping",
    });
    await nextTick();
    expect(statusStepState.value).toBe("requesting");

    settleTurn(store, { sessionId: "session-1", turnScopeId: "turn-1", state: "stop_completed" });
    await nextTick();
    expect(statusStepState.value).toBe("stopped");
  });

  it("follows turn identity rather than message order, object lifetime, or active Session", async () => {
    const store = useChatStore();
    const message = ref({ role: "assistant", turnPlaceholder: true, turnScopeId: "turn-a" });
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message.value });

    applyEvent(store, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "session-a",
      turnScopeId: "turn-a",
    });
    applyEvent(store, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "session-a",
      turnScopeId: "turn-a",
    });
    startAuthorityProcessing(store, "session-a", "turn-a");
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
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "session-1",
      turnScopeId: "client-turn:main",
    });
    applyEvent(store, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "session-1",
      turnScopeId: "client-turn:main",
    });
    applyEvent(store, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "session-1",
      turnScopeId: "client-turn:main",
    });
    settleTurn(store, { sessionId: "session-1", turnScopeId: "client-turn:main", state: "completed" });
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message });
    await nextTick();
    expect(statusStepState.value).toBe("completed");
    expect(message.turnScopeId).toBe("internal-turn:child");
  });

  it("does not promote persisted completed to a protocol terminal before Registry hydration", async () => {
    const message = {
      role: "assistant",
      turnScopeId: "internal-turn:child",
      statusTurnScopeId: "client-turn:main",
      persistedStatusStepState: "completed",
    };
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message });
    await nextTick();
    expect(statusStepState.value).toBe("");
  });

  it("renders an authoritative child Execution projection without hydrating the Registry", async () => {
    const message = {
      role: "assistant",
      sessionId: "child-session",
      turnScopeId: "workflow-node:child",
      statusTurnScopeId: "workflow-node:child",
      projectedStatusStepState: "completed",
    };
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message });
    await nextTick();
    expect(statusStepState.value).toBe("completed");
  });

  it("keeps the child Execution projection when an unresolved backend terminal runtime has no display state", async () => {
    const store = useChatStore();
    const message = {
      role: "assistant",
      sessionId: "child-session",
      turnScopeId: "workflow-node:child",
      statusTurnScopeId: "workflow-node:child",
      projectedStatusStepState: "completed",
    };
    applyEvent(store, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "child-session",
      turnScopeId: "workflow-node:child",
    });
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message });
    await nextTick();
    expect(statusStepState.value).toBe("completed");
  });

  it("keeps an active runtime ahead of an older child Execution projection", async () => {
    const store = useChatStore();
    const message = {
      role: "assistant",
      sessionId: "child-session",
      turnScopeId: "workflow-node:child",
      statusTurnScopeId: "workflow-node:child",
      projectedStatusStepState: "completed",
    };
    applyEvent(store, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "child-session",
      turnScopeId: "workflow-node:child",
    });
    applyEvent(store, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "child-session",
      turnScopeId: "workflow-node:child",
    });
    startAuthorityProcessing(store, "child-session", "workflow-node:child");
    const { statusStepState } = useMessageMeta({ getMessageItem: () => message });
    await nextTick();
    expect(statusStepState.value).toBe("sending");
  });
});
