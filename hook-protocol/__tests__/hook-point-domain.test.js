/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  HOOK_POINT,
  HOOK_POINT_DESCRIPTORS,
  HOOK_POINT_DOMAIN,
  hookPointDomain,
  isHookPointInDomain,
  requireHookPointDomain,
  resolveSessionDeletionTargets,
} from "../src/index.js";

test("every declared hook point resolves to a known domain", () => {
  const points = Object.values(HOOK_POINT).flatMap((domain) => Object.values(domain));
  assert.ok(points.length > 0);
  for (const point of points) {
    assert.notEqual(hookPointDomain(point), "", `${point} must resolve a domain`);
  }
});

test("HOOK_POINT group keys stay aligned with the domain vocabulary", () => {
  for (const [groupKey, group] of Object.entries(HOOK_POINT)) {
    const domain = HOOK_POINT_DOMAIN[groupKey];
    assert.equal(typeof domain, "string", `${groupKey} must have a domain constant`);
    for (const point of Object.values(group)) {
      assert.equal(hookPointDomain(point), domain);
    }
  }
});

test("descriptors expose the domain of their point", () => {
  for (const [point, descriptor] of Object.entries(HOOK_POINT_DESCRIPTORS)) {
    assert.equal(descriptor.domain, hookPointDomain(point));
  }
});

test("unknown domains resolve to empty instead of a raw prefix", () => {
  assert.equal(hookPointDomain("bogus.point"), "");
  assert.equal(hookPointDomain(""), "");
  assert.equal(hookPointDomain(null), "");
  assert.equal(hookPointDomain("agent"), "");
});

test("requireHookPointDomain rejects unknown domains", () => {
  assert.equal(requireHookPointDomain(HOOK_POINT.BOT.AFTER_SESSION_RUN), HOOK_POINT_DOMAIN.BOT);
  assert.throws(() => requireHookPointDomain("bogus.point"), /unknown hook point domain/);
});

test("isHookPointInDomain never matches an empty domain", () => {
  assert.equal(isHookPointInDomain(HOOK_POINT.AGENT.BEFORE_TURN, HOOK_POINT_DOMAIN.AGENT), true);
  assert.equal(
    isHookPointInDomain(HOOK_POINT.BOT.BEFORE_SESSION_RUN, HOOK_POINT_DOMAIN.AGENT),
    false,
  );
  assert.equal(isHookPointInDomain("bogus.point", ""), false);
});

test("service hook points are the only ones owned by the service surface", () => {
  const serviceOwned = Object.keys(HOOK_POINT_DESCRIPTORS).filter(
    (point) => hookPointDomain(point) === HOOK_POINT_DOMAIN.SERVICE,
  );
  assert.deepEqual(serviceOwned, [HOOK_POINT.SERVICE.AFTER_SESSION_DELETE]);
});

test("resolveSessionDeletionTargets normalizes and dedupes deleted ids", () => {
  assert.deepEqual(
    resolveSessionDeletionTargets({ deletedSessionIds: [" a ", "b", "a", "", null] }),
    ["a", "b"],
  );
});

test("resolveSessionDeletionTargets falls back to the single session id", () => {
  assert.deepEqual(resolveSessionDeletionTargets({ deletedSessionIds: [], sessionId: " s " }), [
    "s",
  ]);
  assert.deepEqual(resolveSessionDeletionTargets({ deletedSessionIds: ["  "], sessionId: "s" }), [
    "s",
  ]);
});

test("resolveSessionDeletionTargets returns empty when nothing is resolvable", () => {
  assert.deepEqual(resolveSessionDeletionTargets({}), []);
  assert.deepEqual(resolveSessionDeletionTargets(), []);
  assert.deepEqual(resolveSessionDeletionTargets({ deletedSessionIds: "not-an-array" }), []);
});
