/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applyTurnRuntimeEvent,
  applyTurnTerminalResolution,
  createTurnRuntimeRegistryState,
  removeSessionRuntime,
  resolveTurnRuntimeByScope,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { createTurnTerminalResolution } from "@noobot/authoritative-state/contracts";

function event(registry, type, sessionId, turnScopeId, dialogProcessId, extra = {}) {
  return applyTurnRuntimeEvent(registry, { type, sessionId, turnScopeId, dialogProcessId, ...extra });
}

function start(registry, sessionId, turnScopeId, dialogProcessId, seq = 1) {
  event(registry, SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED, sessionId, turnScopeId, "", { seq });
  event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId, turnScopeId, dialogProcessId, {
    state: BackendChannelState.SENDING,
    seq: seq + 1,
  });
}

let resolutionSequence = 0;
function settle(registry, sessionId, turnScopeId, state = "completed", revision = 10) {
  resolutionSequence += 1;
  const completionCommitId = `commit-${sessionId}-${turnScopeId}-${revision}`;
  const failure = state.endsWith("_failed")
    ? { phase: state.replace(/_failed$/, ""), message: `${state} failure`, retryable: false }
    : undefined;
  return applyTurnTerminalResolution(registry, createTurnTerminalResolution({
    commandId: `resolve-${resolutionSequence}`,
    sessionId,
    turnScopeId,
    resolved: true,
    turn: {
      turnScopeId,
      state,
      phase: state.replace(/_failed$/, ""),
      revision,
      sequence: revision,
      completionCommitId,
      summaryVersion: revision,
      failure,
      capabilities: { actionLocked: false, canStop: false },
    },
    materialization: {
      completionCommitId,
      summaryVersion: revision,
      revision,
      sequence: revision,
      terminalStatus: { status: state },
      messages: [],
    },
  }));
}

const turn = (registry, sessionId, turnScopeId) =>
  resolveTurnRuntimeByScope(registry, turnScopeId, { sessionId });

describe("turnRuntimeRegistry main/sub-session concurrent fault isolation", () => {
  it("settles identical Turn scopes only in their exact Session identities", () => {
    const registry = createTurnRuntimeRegistryState();
    start(registry, "child-b", "shared", "dp-b");
    start(registry, "main", "shared", "dp-main");

    expect(settle(registry, "main", "shared").applied).toBe(true);
    expect(turn(registry, "main", "shared")?.terminal).toBe("completed");
    expect(turn(registry, "child-b", "shared")?.terminal).toBeNull();
    expect(turn(registry, "child-a", "shared")).toBeNull();

    start(registry, "child-a", "shared", "dp-a");
    expect(settle(registry, "child-b", "shared").applied).toBe(true);
    expect(settle(registry, "child-a", "shared").applied).toBe(true);
    expect(turn(registry, "child-a", "shared")?.terminal).toBe("completed");
    expect(turn(registry, "child-b", "shared")?.terminal).toBe("completed");
  });

  it("isolates stale, mismatched, stop, and failure facts across concurrent Turns", () => {
    const registry = createTurnRuntimeRegistryState();
    start(registry, "main", "main-turn", "dp-main");
    start(registry, "child", "child-turn", "dp-child");

    const mismatched = event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, "main", "main-turn", "dp-child", {
      state: BackendChannelState.COMPLETED,
      seq: 99,
    });
    expect(mismatched).toMatchObject({ applied: false, reason: "dialog_process_identity_conflict" });

    expect(settle(registry, "child", "child-turn", "stop_completed").applied).toBe(true);
    expect(turn(registry, "child", "child-turn")?.terminal).toBe("user_stopped");
    expect(turn(registry, "main", "main-turn")).toMatchObject({ state: "frontend_processing", terminal: null });

    const stale = event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, "main", "child-turn", "dp-child", {
      state: BackendChannelState.ERROR,
      seq: 6,
      error: "late child failure",
    });
    expect(stale.applied).toBe(false);
    expect(turn(registry, "main", "main-turn")?.terminal).toBeNull();
  });

  it("keeps Session deletion scoped while another Session remains terminal", () => {
    const registry = createTurnRuntimeRegistryState();
    start(registry, "child", "t", "dp-child");
    expect(settle(registry, "child", "t").applied).toBe(true);

    start(registry, "main", "new-main", "dp-main-new");
    expect(removeSessionRuntime(registry, "main")).toBe(true);
    expect(turn(registry, "child", "t")?.terminal).toBe("completed");
    expect(registry.sessions.main).toBeUndefined();
  });

  it("promotes one optimistic child alias without moving the main Session Turn", () => {
    const registry = createTurnRuntimeRegistryState();
    start(registry, "main", "main-turn", "dp-main");
    event(registry, SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED, "child-local", "child-turn", "", { seq: 1 });
    event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, "child-canonical", "child-turn", "dp-child", {
      state: BackendChannelState.SENDING,
      seq: 2,
    });

    expect(turn(registry, "child-local", "child-turn")?.sessionId).toBe("child-canonical");
    expect(turn(registry, "child-canonical", "child-turn")).toBeTruthy();
    expect(settle(registry, "child-canonical", "child-turn").applied).toBe(true);
    expect(turn(registry, "child-canonical", "child-turn")?.terminal).toBe("completed");
    expect(turn(registry, "main", "main-turn")?.terminal).toBeNull();
  });
});
