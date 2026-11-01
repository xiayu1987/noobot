/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applyTurnRuntimeEvent,
  createTurnRuntimeRegistryState,
  resolveTurnRuntimeByScope,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { findTurnByScope } from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistryIdentity.js";
import {
  AGENT_CHANNEL_STATE,
  SESSION_RUN_EVENT,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { backendState, sendStart } from "./turnRuntimeRegistryTestFixtures.js";

describe("turnRuntimeRegistry: event identity isolation", () => {
  it.each([undefined, "", "unknown-dialog"])(
    "rejects an event without session identity for dialog %s without changing a same-scoped turn",
    (dialogProcessId) => {
      const registry = createTurnRuntimeRegistryState();
      sendStart(registry, { sessionId: "s1", turnScopeId: "shared" });
      sendStart(registry, { sessionId: "s2", turnScopeId: "shared" });
      const before = structuredClone(registry);

      const result = applyTurnRuntimeEvent(registry, {
        updatedAtMs: 1767225600000,
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        turnScopeId: "shared",
        dialogProcessId,
        state: AGENT_CHANNEL_STATE.ERROR,
        seq: 2,
      });

      expect(result).toMatchObject({
        applied: false,
        reason:
          dialogProcessId === undefined ? "invalid_runtime_event" : "missing_session_identity",
        turn: null,
      });
      expect(registry).toEqual(before);
    },
  );

  it("does not inspect unrelated session buckets when an event has no session identity", () => {
    const registry = createTurnRuntimeRegistryState();
    Object.defineProperty(registry.sessions, "unrelated", {
      enumerable: true,
      get() {
        throw new Error("unrelated session accessed");
      },
    });

    expect(findTurnByScope(registry, "shared", { sessionId: "" })).toBeNull();
    expect(
      applyTurnRuntimeEvent(registry, {
        updatedAtMs: 1767225600000,
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        turnScopeId: "shared",
        state: AGENT_CHANNEL_STATE.ERROR,
        seq: 2,
      }),
    ).toMatchObject({ applied: false, reason: "missing_session_identity", turn: null });
  });

  it("does not reconstruct missing identity from an established dialog route", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "shared" });
    backendState(registry, {
      sessionId: "s1",
      turnScopeId: "shared",
      dialogProcessId: "dp1",
      state: AGENT_CHANNEL_STATE.SENDING,
      seq: 2,
    });
    sendStart(registry, { sessionId: "s2", turnScopeId: "shared" });
    const otherTurn = structuredClone(registry.sessions.s2);

    const result = applyTurnRuntimeEvent(registry, {
      updatedAtMs: 1767225600000,
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      dialogProcessId: "dp1",
      state: AGENT_CHANNEL_STATE.COMPLETED,
      seq: 3,
    });

    expect(result).toMatchObject({
      applied: false,
      reason: "missing_turn_identity",
      turn: null,
    });
    expect(registry.sessions.s2).toEqual(otherTurn);
  });

  it("rejects a dialog route that conflicts with an explicit session identity", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "shared" });
    backendState(registry, {
      sessionId: "s1",
      turnScopeId: "shared",
      dialogProcessId: "dp1",
      state: AGENT_CHANNEL_STATE.SENDING,
      seq: 2,
    });
    sendStart(registry, { sessionId: "s2", turnScopeId: "shared" });
    const before = structuredClone(registry);

    expect(
      applyTurnRuntimeEvent(registry, {
        updatedAtMs: 1767225600000,
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        sessionId: "s2",
        turnScopeId: "shared",
        dialogProcessId: "dp1",
        state: AGENT_CHANNEL_STATE.ERROR,
        seq: 3,
      }),
    ).toMatchObject({ applied: false, reason: "dialog_process_identity_conflict" });
    expect(registry).toEqual(before);
    expect(resolveTurnRuntimeByScope(registry, "shared", { sessionId: "s2" })).toMatchObject({
      sessionId: "s2",
      commandPending: true,
    });
  });
});
