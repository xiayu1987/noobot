import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSessionEntity } from "../../../src/system-core/session/entities/session-entity.js";
import { buildSessionDisplaySummary } from "../../../src/system-core/session/session-summary-builders.js";

const now = () => "2026-07-10T00:00:00.000Z";

test("legacy message terminal fields neither create turnStatuses nor survive normalization", () => {
  const session = normalizeSessionEntity({
    sessionId: "s1",
    messages: [{
      role: "user",
      content: "legacy",
      turnScopeId: "t1",
      state: "user_stopped",
      status: "user_stopped",
      channelState: "user_stopped",
      stopState: "user_stopped",
      monotonicState: "monotonic",
    }],
  }, { now });

  assert.deepEqual(session.turnStatuses, []);
  const message = session.messages[0];
  for (const key of ["state", "status", "channelState", "stopState", "monotonicState"]) {
    assert.equal(message[key], undefined);
  }
});

test("summary projects explicit turnStatuses without message fallback", () => {
  const session = normalizeSessionEntity({
    sessionId: "s1",
    messages: [{ role: "user", content: "hello", turnScopeId: "t1" }],
    turnStatuses: [{
      turnScopeId: "t1",
      status: "timeout",
      reason: "run_timeout",
      description: "timeout",
      createdAt: now(),
      updatedAt: now(),
    }],
  }, { now });
  const summary = buildSessionDisplaySummary(session);
  assert.equal(summary.turnStatuses.length, 1);
  assert.equal(summary.turnStatuses[0].status, "timeout");
  assert.equal(summary.messages[0].state, undefined);
  assert.equal(summary.messages[0].stopState, undefined);
});

test("parent and child sessions own independent turn status values", () => {
  const parent = normalizeSessionEntity({
    sessionId: "parent",
    turnStatuses: [{ turnScopeId: "parent-turn", status: "completed", reason: "run_completed" }],
  }, { now });
  const child = normalizeSessionEntity({
    sessionId: "child",
    parentSessionId: "parent",
    turnStatuses: [{ turnScopeId: "child-turn", status: "timeout", reason: "run_timeout" }],
  }, { now });

  assert.deepEqual(parent.turnStatuses.map((item) => item.turnScopeId), ["parent-turn"]);
  assert.deepEqual(child.turnStatuses.map((item) => item.turnScopeId), ["child-turn"]);
  child.turnStatuses[0].description = "mutated child";
  assert.equal(parent.turnStatuses[0].description, undefined);
});

test("synthetic status placeholders cannot enter session persistence or summary", () => {
  const session = normalizeSessionEntity({
    sessionId: "s-placeholder",
    messages: [{
      role: "assistant",
      content: "本轮异常停止",
      turnScopeId: "t1",
      synthetic: true,
      placeholder: true,
      turnStatusPlaceholder: true,
      turnStatus: { turnScopeId: "t1", status: "error" },
      state: "error",
      status: "error",
    }],
  }, { now });

  assert.deepEqual(session.turnStatuses, []);
  const message = session.messages[0];
  for (const key of ["synthetic", "placeholder", "turnStatusPlaceholder", "turnStatus", "state", "status"]) {
    assert.equal(message[key], undefined);
  }
  const summary = buildSessionDisplaySummary(session);
  assert.deepEqual(summary.turnStatuses, []);
  assert.equal(summary.messages[0].turnStatusPlaceholder, undefined);
});
