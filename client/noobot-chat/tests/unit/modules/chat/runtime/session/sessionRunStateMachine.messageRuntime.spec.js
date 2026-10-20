/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  AGENT_CHANNEL_STATE,
  FrontendRunState,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
  SESSION_RUN_MESSAGE_RUNTIME_REASON,
  createInitialSessionRunState,
  getMessageRuntimeChannelState,
  isMessageInFlightAssistant,
  isMessageRunning,
  resolveSessionRunMessageRuntimeView,
  resolveTurnRuntimeView,
  resolveSessionRunMessageRuntimePatch,
  resolveSessionRunStateForMessage,
} from "../../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";

function installStorage() {
  const map = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
      clear: () => map.clear(),
    },
  });
}

function runtimeOf(fields = {}) {
  return {
    state: "",
    backendState: "",
    displayState: "",
    startedAt: "",
    finishedAt: "",
    modelLoopRound: 0,
    ...fields,
  };
}

describe("sessionRunStateMachine message runtime", () => {
  beforeEach(() => installStorage());

  it("uses the terminal registry runtime over a stale sending message", () => {
    const view = resolveTurnRuntimeView({
      messageItem: {
        role: "assistant",
        pending: true,
        channelState: { state: AGENT_CHANNEL_STATE.SENDING },
      },
      runtime: runtimeOf({ state: FrontendRunState.FRONTEND_COMPLETED }),
    });

    expect(view).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
      running: false,
      terminal: true,
      inFlightAssistant: false,
    });
  });

  it("uses the backend execution state while the registry turn is in flight", () => {
    const view = resolveTurnRuntimeView({
      messageItem: { role: "assistant", pending: false },
      runtime: runtimeOf({
        state: FrontendRunState.PROCESSING,
        backendState: AGENT_CHANNEL_STATE.SENDING,
        displayState: "sending",
      }),
    });

    expect(view).toMatchObject({
      state: AGENT_CHANNEL_STATE.SENDING,
      displayState: "sending",
      running: true,
      inFlightAssistant: true,
    });
  });

  it("does not infer an active run from an unfinished timing record", () => {
    const view = resolveTurnRuntimeView({
      messageItem: {
        role: "assistant",
        pending: false,
        turnScopeId: "client-turn:stopped-history",
      },
      runtime: runtimeOf({ startedAt: "2026-09-10T13:51:21.730Z" }),
    });

    expect(view).toMatchObject({
      state: "",
      running: false,
      inFlightAssistant: false,
      startedAt: "2026-09-10T13:51:21.730Z",
      finishedAt: "",
    });
  });

  it("does not resolve message runtime from the identity-free global lock", () => {
    const assistant = { role: "assistant", dialogProcessId: "d1", turnScopeId: "turn-1" };
    expect(
      resolveSessionRunStateForMessage({
        stateSnapshot: createInitialSessionRunState({ state: FrontendRunState.ACTION_REQUESTING }),
        messageItem: assistant,
        activeSession: { id: "s1", messages: [assistant] },
      }),
    ).toBeNull();
  });

  it("does not resolve terminal or different-session run state for a message", () => {
    const assistant = {
      role: "assistant",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
      content: "",
    };
    const activeSession = {
      id: "s1",
      sessionId: "s1",
      messages: [{ role: "user", content: "q" }, assistant],
    };

    expect(
      resolveSessionRunStateForMessage({
        stateSnapshot: createInitialSessionRunState({
          state: FrontendRunState.FRONTEND_COMPLETED,
          sessionId: "s1",
          dialogProcessId: "d1",
          priority: 100,
        }),
        messageItem: assistant,
        activeSession,
      }),
    ).toBeNull();
    expect(
      resolveSessionRunStateForMessage({
        stateSnapshot: createInitialSessionRunState({
          state: AGENT_CHANNEL_STATE.SENDING,
          sessionId: "s2",
          dialogProcessId: "d1",
          priority: 40,
        }),
        messageItem: assistant,
        activeSession,
      }),
    ).toBeNull();
  });

  it("does not patch message runtime from the identity-free global lock", () => {
    const assistant = { role: "assistant", dialogProcessId: "d1", turnScopeId: "turn-1" };
    expect(
      resolveSessionRunMessageRuntimePatch({
        stateSnapshot: createInitialSessionRunState({ state: FrontendRunState.ACTION_REQUESTING }),
        messageItem: assistant,
        activeSession: { id: "s1", messages: [assistant] },
      }),
    ).toMatchObject({ action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE });
  });

  it("does not clear active message runtime from another session terminal state", () => {
    const assistant = {
      role: "assistant",
      pending: true,
      dialogProcessId: "d-active",
      turnScopeId: "turn-active",
      content: "",
      [SESSION_RUN_MESSAGE_RUNTIME_MARK]: "sending|s-active|d-active|turn-active|",
      channelState: {
        state: AGENT_CHANNEL_STATE.SENDING,
        sessionId: "s-active",
        dialogProcessId: "d-active",
        turnScopeId: "turn-active",
      },
      realtimeLogs: [{ event: "tool_call", type: "tool_call", text: "running" }],
    };
    const activeSession = {
      id: "s-active",
      sessionId: "s-active",
      messages: [{ role: "user", content: "q" }, assistant],
    };

    expect(
      resolveSessionRunMessageRuntimePatch({
        stateSnapshot: createInitialSessionRunState({
          state: FrontendRunState.FRONTEND_COMPLETED,
          sessionId: "s-other",
          dialogProcessId: "d-other",
          turnScopeId: "turn-other",
          priority: 100,
        }),
        messageItem: assistant,
        activeSession,
      }),
    ).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE,
    });

    expect(
      resolveSessionRunMessageRuntimePatch({
        stateSnapshot: createInitialSessionRunState({
          state: FrontendRunState.USER_STOP_COMPLETED,
          backendState: AGENT_CHANNEL_STATE.USER_STOPPED,
          sessionId: "s-other",
          dialogProcessId: "d-other",
          turnScopeId: "turn-other",
          priority: 100,
        }),
        messageItem: assistant,
        activeSession,
      }),
    ).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE,
    });
  });

  it("does not regress finalized stopped assistant to in-flight runtime patch", () => {
    const assistant = {
      role: "assistant",
      pending: false,
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
      channelState: {
        state: AGENT_CHANNEL_STATE.USER_STOPPED,
        dialogProcessId: "d1",
        turnScopeId: "turn-1",
      },
      terminalOutcome: "stopped",
    };
    const activeSession = {
      id: "s1",
      sessionId: "s1",
      messages: [{ role: "user", content: "q" }, assistant],
    };

    expect(
      resolveSessionRunMessageRuntimePatch({
        stateSnapshot: createInitialSessionRunState({
          state: FrontendRunState.USER_STOPPING,
          backendState: AGENT_CHANNEL_STATE.STOPPING,
          sessionId: "s1",
          dialogProcessId: "d1",
          turnScopeId: "turn-1",
          sourceEvent: "user_stop_requested_registry",
          priority: 70,
        }),
        messageItem: assistant,
        activeSession,
      }),
    ).toMatchObject({ action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE });
  });

  it("applies a stopped registry runtime to a refreshed pending assistant", () => {
    const assistant = {
      role: "assistant",
      pending: true,
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
      channelState: { state: "sending" },
    };
    expect(
      resolveTurnRuntimeView({
        messageItem: assistant,
        runtime: runtimeOf({ state: FrontendRunState.USER_STOP_COMPLETED }),
      }),
    ).toMatchObject({
      state: FrontendRunState.USER_STOP_COMPLETED,
      running: false,
      terminal: true,
    });
  });

  it("resolves obsolete previous pending assistant as clear_runtime", () => {
    const oldAssistant = {
      role: "assistant",
      pending: true,
      channelState: { state: "sending" },
      content: "old",
    };
    const latestAssistant = { role: "assistant", pending: false, content: "new" };
    const activeSession = {
      id: "s1",
      sessionId: "s1",
      messages: [
        { role: "user", content: "old q" },
        oldAssistant,
        { role: "user", content: "new q" },
        latestAssistant,
      ],
    };

    expect(
      resolveSessionRunMessageRuntimePatch({
        stateSnapshot: createInitialSessionRunState({
          state: AGENT_CHANNEL_STATE.SENDING,
          sessionId: "s1",
        }),
        messageItem: oldAssistant,
        activeSession,
      }),
    ).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.OBSOLETE_PENDING_ASSISTANT,
      patch: {
        clearRuntimeMark: true,
        pending: false,
        channelState: { state: FrontendRunState.FRONTEND_COMPLETED },
      },
    });
  });

  it("resolves message runtime selector from runtime-written channelState", () => {
    const sendingMessage = {
      role: "assistant",
      pending: true,
      channelState: {
        state: AGENT_CHANNEL_STATE.SENDING,
        sessionId: "s1",
        dialogProcessId: "d1",
        turnScopeId: "turn-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdAtMs: 1000,
      },
    };
    expect(getMessageRuntimeChannelState(sendingMessage)).toMatchObject({
      state: AGENT_CHANNEL_STATE.SENDING,
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
    });
    expect(
      resolveTurnRuntimeView({
        messageItem: sendingMessage,
        runtime: runtimeOf({ startedAt: "2026-01-01T00:00:00.000Z" }),
      }),
    ).toMatchObject({
      state: AGENT_CHANNEL_STATE.SENDING,
      pending: true,
      running: true,
      inFlightAssistant: true,
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(isMessageRunning(sendingMessage)).toBe(true);
    expect(isMessageInFlightAssistant(sendingMessage)).toBe(true);

    expect(
      resolveSessionRunMessageRuntimeView({
        role: "assistant",
        channelState: { state: "reconnecting" },
      }),
    ).toMatchObject({
      state: AGENT_CHANNEL_STATE.RECONNECTING,
      running: true,
      inFlightAssistant: true,
    });

    expect(
      resolveSessionRunMessageRuntimeView({
        role: "assistant",
        channelState: { state: "interaction_pending" },
      }),
    ).toMatchObject({
      state: AGENT_CHANNEL_STATE.INTERACTION_PENDING,
      running: true,
      inFlightAssistant: true,
    });

    expect(
      resolveSessionRunMessageRuntimeView({
        role: "assistant",
        channelState: { state: FrontendRunState.USER_STOPPING },
        pending: true,
      }),
    ).toMatchObject({
      state: FrontendRunState.USER_STOPPING,
      running: true,
      inFlightAssistant: true,
    });

    expect(
      resolveSessionRunMessageRuntimeView({
        role: "user",
        pending: true,
      }),
    ).toMatchObject({
      running: true,
      inFlightAssistant: false,
    });
  });
});
