/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { turnRecord } from "../helpers/turn-record.js";
import { ImmutableSessionChanges } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  prepareImmutableLifecycleIndex,
  readImmutableLifecycleTurns,
  upgradeImmutableLifecycleIndex,
} from "../../src/session/session-artifact-session/immutable-lifecycle-index.js";

const identity = (collection, key) => JSON.stringify([collection, key]);
function fixture() {
  const values = new Map();
  const get = async (collection, key) => values.get(identity(collection, key)) ?? null;
  const apply = (plan) => {
    for (const change of plan.changes()) {
      const key = identity(change.collection, change.key);
      if (change.remove) values.delete(key);
      else values.set(key, structuredClone(change.value));
    }
  };
  return { values, get, apply, plan: () => new ImmutableSessionChanges(get) };
}
const record = (index, extra = {}) =>
  turnRecord({
    turnScopeId: `turn-${index}`,
    dialogProcessId: `dialog-${index}`,
    state: "completed",
    sequence: index + 1,
    ...extra,
  });

test("terminal selection reads only its bounded candidates across a cold 1024-turn index", async () => {
  const f = fixture();
  const plan = f.plan();
  for (let i = 0; i < 1024; i += 1) {
    const turn = record(i);
    plan.set("lifecycle", turn.turnScopeId, turn);
    plan.set("turns", turn.turnScopeId, { turnScopeId: turn.turnScopeId });
  }
  await prepareImmutableLifecycleIndex(plan, { initialize: true });
  f.apply(plan);
  const reads = [];
  const selected = await readImmutableLifecycleTurns(
    async (collection, key) => {
      reads.push([collection, key]);
      if (["lifecycle", "turns"].includes(collection))
        assert.ok(["turn-1023", "turn-1022", "turn-1021"].includes(key));
      return f.get(collection, key);
    },
    { terminalLimit: 3 },
  );
  assert.deepEqual(
    selected.map((turn) => turn.turnScopeId),
    ["turn-1023", "turn-1022", "turn-1021"],
  );
  assert.ok(reads.filter(([collection]) => collection === "lifecycleOrder").length < 30);
  assert.deepEqual(await readImmutableLifecycleTurns(f.get, { terminalLimit: 0 }), []);
  for (const terminalLimit of [-1, 101, NaN, "1"])
    await assert.rejects(readImmutableLifecycleTurns(f.get, { terminalLimit }), TypeError);
});

test("message membership, failed turns and lifecycle revisions update selection without a history scan", async () => {
  const f = fixture();
  let plan = f.plan();
  for (let i = 0; i < 4; i += 1)
    plan.set("lifecycle", `turn-${i}`, record(i, i === 2 ? { state: "action_failed" } : {}));
  plan.set("turns", "turn-0", {});
  plan.set("turns", "turn-1", {});
  await prepareImmutableLifecycleIndex(plan, { initialize: true });
  f.apply(plan);
  assert.deepEqual(
    (await readImmutableLifecycleTurns(f.get)).map((turn) => turn.turnScopeId),
    ["turn-2", "turn-1", "turn-0"],
  );
  const pinned = new Map(f.values);
  plan = f.plan();
  plan.remove("turns", "turn-1");
  plan.set("lifecycle", "turn-0", record(0, { sequence: 8, continuedByTurnScopeId: "turn-3" }));
  plan.set("turns", "turn-3", {});
  await prepareImmutableLifecycleIndex(plan);
  f.apply(plan);
  assert.deepEqual(
    (await readImmutableLifecycleTurns(f.get)).map((turn) => turn.turnScopeId),
    ["turn-0", "turn-3", "turn-2"],
  );
  assert.deepEqual(
    (
      await readImmutableLifecycleTurns(
        async (collection, key) => pinned.get(identity(collection, key)) ?? null,
      )
    ).map((turn) => turn.turnScopeId),
    ["turn-2", "turn-1", "turn-0"],
  );
  plan = f.plan();
  for (let i = 0; i < 4; i += 1) {
    plan.remove("turns", `turn-${i}`);
    plan.remove("lifecycle", `turn-${i}`);
  }
  await prepareImmutableLifecycleIndex(plan);
  f.apply(plan);
  assert.deepEqual(await readImmutableLifecycleTurns(f.get), []);
  assert.equal(
    [...f.values.keys()].some((key) => JSON.parse(key)[0] === "lifecycleOrder"),
    false,
  );
});

test("missing, misplaced and stale candidate nodes reject corruption instead of skipping it", async () => {
  const f = fixture();
  const plan = f.plan();
  plan.set("lifecycle", "turn-1", record(1, { state: "action_failed" }));
  await prepareImmutableLifecycleIndex(plan, { initialize: true });
  f.apply(plan);
  const root = (await f.get("metadata", "lifecycleIndex")).root;
  for (const corrupt of [null, {}, { kind: "branch", prefix: root, zero: root, one: root }])
    await assert.rejects(
      readImmutableLifecycleTurns(async (collection, key) =>
        collection === "lifecycleOrder" ? corrupt : f.get(collection, key),
      ),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
  f.values.delete(identity("lifecycle", "turn-1"));
  await assert.rejects(readImmutableLifecycleTurns(f.get), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  f.values.delete(identity("metadata", "lifecycleIndex"));
  await assert.rejects(readImmutableLifecycleTurns(f.get), {
    code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
  });
});

test("offline lifecycle upgrade is durable, repeatable and leaves its older generation unchanged", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "lifecycle-index-upgrade-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "legacy",
    changes: [
      { collection: "lifecycle", key: "turn-1", value: record(1, { state: "action_failed" }) },
    ],
  });
  const pinned = await store.snapshot();
  const result = await upgradeImmutableLifecycleIndex({ sessionDir, sessionId: "s1" });
  assert.equal(result.result.upgraded, true);
  const current = await store.snapshot();
  assert.equal(current.generation, pinned.generation + 1);
  const get = (collection, key) => store.get(current, collection, key);
  assert.equal((await readImmutableLifecycleTurns(get))[0].turnScopeId, "turn-1");
  assert.equal(await store.get(pinned, "metadata", "lifecycleIndex"), null);
  assert.equal(
    (await upgradeImmutableLifecycleIndex({ sessionDir, sessionId: "s1" })).aborted,
    true,
  );
  assert.equal((await store.snapshot()).generation, current.generation);
});
