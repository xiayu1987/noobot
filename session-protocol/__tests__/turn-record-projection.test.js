/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { snapshotTurn } from "../src/lifecycle/turn-projection.js";
import { assertTurnRecord } from "../src/index.js";
import { turnRecord } from "./helpers/turn-record.js";

test("snapshot projects declared facts without exposing storage fields or sharing nested state", () => {
  const source = turnRecord({
    sessionId: "session-1",
    origin: { type: "test" },
    storageLocator: "/private/session",
    capabilities: { injected: true },
  });
  const before = structuredClone(source);
  const result = snapshotTurn(source);
  assert.equal(result.sessionId, source.sessionId);
  assert.equal(Object.hasOwn(result, "storageLocator"), false);
  assert.equal(Object.hasOwn(result.capabilities, "injected"), false);
  assert.deepEqual(result.origin, source.origin);
  assert.notEqual(result.origin, source.origin);
  result.origin.type = "changed";
  assert.deepEqual(source, before);
});

for (const [field, value] of [
  ["origin", []],
  ["finalizeIntent", {}],
  ["revision", "1"],
  ["summaryVersion", -1],
  ["continuedByTurnScopeId", " turn-2"],
  ["failure", undefined],
  ["terminalStatus", {}],
  ["continuationSource", []],
  ["action", "unknown"],
]) {
  test(`record and snapshot reject damaged ${field} without repairing it`, () => {
    const source = turnRecord({ [field]: value });
    const before = structuredClone(source);
    for (const consume of [assertTurnRecord, snapshotTurn]) {
      assert.throws(() => consume(source), { code: "TURN_LIFECYCLE_RECORD_INVALID" });
      assert.deepEqual(source, before);
    }
  });
}

for (const [state, phase] of [
  ["completion_requesting", "completion"],
  ["stopping", "stop"],
  ["completion_failed", "completion"],
  ["stop_failed", "stop"],
]) {
  test(`record requires an active finalize intent for ${state}`, () => {
    const source = turnRecord({
      state,
      phase,
      finishedAt: state.endsWith("_failed") ? "2026-07-30T00:00:01.000Z" : "",
      failure: state.endsWith("_failed")
        ? { code: "finalize_failed", message: "retry", retryable: true }
        : null,
      finalizeIntent: {
        type: phase === "stop" ? "stop" : "completion",
        commandId: "finalize-1",
        retryable: true,
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:01.000Z",
      },
    });
    assert.equal(assertTurnRecord(source), source);
    for (const finalizeIntent of [null, { ...source.finalizeIntent, retryable: false }]) {
      const damaged = { ...source, finalizeIntent };
      const before = structuredClone(damaged);
      assert.throws(() => snapshotTurn(damaged), { code: "TURN_LIFECYCLE_RECORD_INVALID" });
      assert.deepEqual(damaged, before);
    }
  });
}

test("requireAcceptedTurnRecord returns the Authority Turn record for the run identity", async () => {
  const { requireAcceptedTurnRecord } = await import("../src/index.js");
  const turn = turnRecord({ turnScopeId: "turn-1", dialogProcessId: "dialog-1" });
  const lifecycle = { turns: { "turn-1": turn } };
  assert.equal(
    requireAcceptedTurnRecord(lifecycle, { turnScopeId: "turn-1", dialogProcessId: "dialog-1" })
      .startedAt,
    turn.startedAt,
  );
  assert.throws(
    () =>
      requireAcceptedTurnRecord(lifecycle, { turnScopeId: "turn-2", dialogProcessId: "dialog-1" }),
    { code: "TURN_LIFECYCLE_TURN_NOT_FOUND" },
  );
  assert.throws(
    () =>
      requireAcceptedTurnRecord(undefined, { turnScopeId: "turn-1", dialogProcessId: "dialog-1" }),
    { code: "TURN_LIFECYCLE_TURN_NOT_FOUND" },
  );
  assert.throws(
    () =>
      requireAcceptedTurnRecord(lifecycle, { turnScopeId: "turn-1", dialogProcessId: "dialog-2" }),
    { code: "TURN_LIFECYCLE_IDENTITY_MISMATCH" },
  );
  assert.throws(
    () =>
      requireAcceptedTurnRecord(
        { turns: { "turn-1": { ...turn, startedAt: "" } } },
        { turnScopeId: "turn-1", dialogProcessId: "dialog-1" },
      ),
    { code: "TURN_LIFECYCLE_RECORD_INVALID" },
  );
});
