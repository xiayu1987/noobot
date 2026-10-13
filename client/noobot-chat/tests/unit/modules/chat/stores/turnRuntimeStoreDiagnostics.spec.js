/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildLazyDebugRecord } from "../../../../../src/modules/debug/loggers/lazyDebugSink.js";
import {
  buildCommitProjectionDiagnostics,
  buildMessageProjectionDiagnostics,
  buildTurnEvaluatedDiagnostics,
} from "../../../../../src/modules/chat/stores/turnRuntimeStoreDiagnostics.js";

const childTurn = {
  sessionId: "child-1",
  parentSessionId: "parent-1",
  dialogProcessId: "dp-1",
  turnScopeId: "t-1",
  state: "running",
};

describe("turnRuntimeStoreDiagnostics identity", () => {
  it("attributes a child turn to the child session and declares the parent explicitly", () => {
    const builders = [
      buildTurnEvaluatedDiagnostics({
        reducer: "applyTurnRuntimeEvent",
        input: { sessionId: "other", eventType: "x" },
        result: { turn: childTurn },
        applied: true,
      }),
      buildCommitProjectionDiagnostics({ turn: childTurn, result: { applied: true } }),
      buildMessageProjectionDiagnostics({ turn: childTurn }),
    ];
    for (const diagnostics of builders) {
      expect(diagnostics).toMatchObject({
        sessionId: "child-1",
        parentSessionId: "parent-1",
        dialogProcessId: "dp-1",
        turnScopeId: "t-1",
      });
      expect(diagnostics).not.toHaveProperty("nodeSessionId");
      const record = buildLazyDebugRecord("turn-runtime-diagnostics", "e", diagnostics);
      expect(record.sessionId).toBe("child-1");
      expect(record.parentSessionId).toBe("parent-1");
    }
  });

  it("takes identity wholly from the input when the reducer resolved no turn", () => {
    const diagnostics = buildTurnEvaluatedDiagnostics({
      reducer: "applyTurnLifecycleEnvelope",
      input: { sessionId: "child-2", parentSessionId: "parent-2", turnScopeId: "t-2" },
      result: { turn: null, applied: false, reason: "invalid_authoritative_envelope" },
      applied: false,
    });
    expect(diagnostics).toMatchObject({
      sessionId: "child-2",
      parentSessionId: "parent-2",
      dialogProcessId: "",
      turnScopeId: "t-2",
      applied: false,
      reason: "invalid_authoritative_envelope",
    });
  });

  it("never mixes identity fields across the turn and the input", () => {
    const diagnostics = buildTurnEvaluatedDiagnostics({
      reducer: "applyTurnRuntimeEvent",
      input: { sessionId: "s-in", parentSessionId: "p-in", dialogProcessId: "dp-in" },
      result: { turn: { sessionId: "s-turn", turnScopeId: "t-turn" } },
      applied: true,
    });
    expect(diagnostics).toMatchObject({
      sessionId: "s-turn",
      parentSessionId: "",
      dialogProcessId: "",
      turnScopeId: "t-turn",
    });
  });

  it("produces a system record when neither source names a session", () => {
    const diagnostics = buildTurnEvaluatedDiagnostics({
      reducer: "applyExecutionTree",
      input: { rootExecutionId: "" },
      result: { applied: false, reason: "invalid_execution_tree_root" },
      applied: false,
    });
    expect(buildLazyDebugRecord("turn-runtime-diagnostics", "e", diagnostics).scope).toBe("system");
  });
});
