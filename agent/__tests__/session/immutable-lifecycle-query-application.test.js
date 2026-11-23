/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { decideTurnLifecycleSnapshotApplication } from "@noobot/session-protocol";
import {
  immutableMutationFixture,
  mutationMessage,
} from "../helpers/immutable-mutation-integration-fixture.js";
import { turnRecord } from "../helpers/turn-record.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableSessionChanges } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { prepareImmutableLifecycleIndex } from "../../src/session/session-artifact-session/immutable-lifecycle-index.js";

async function seedTerminals(fixture, messages) {
  const store = await ImmutableSessionStore.open({ sessionDir: fixture.scope.sessionDir });
  await store.transact({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "seed-query-window",
    input: {},
    prepare: async ({ get }) => {
      const plan = new ImmutableSessionChanges(get);
      const header = await plan.get("metadata", "lifecycle");
      plan.set("metadata", "lifecycle", { ...header, sequence: messages.length });
      for (const [index, message] of messages.entries())
        plan.set(
          "lifecycle",
          message.turnScopeId,
          turnRecord({
            turnScopeId: message.turnScopeId,
            dialogProcessId: message.dialogProcessId,
            state: "completed",
            sequence: index + 1,
          }),
        );
      await prepareImmutableLifecycleIndex(plan);
      return { changes: plan.changes() };
    },
  });
}

function query(fixture, fields) {
  return fixture.service.getTurnLifecycleSnapshot({
    ...fixture.request,
    commandId: "query-1",
    knownSequence: 0,
    terminalLimit: 1,
    resolveRecovery: async () => "none",
    ...fields,
  });
}
function decide(snapshot, previousObservation) {
  return decideTurnLifecycleSnapshotApplication({
    snapshot,
    previousObservation,
    currentSequence: previousObservation?.sequence ?? 0,
  });
}

test("real bounded queries support repeated requests and expanded windows at the same committed sequence", async (context) => {
  const messages = Array.from({ length: 8 }, (_, index) => mutationMessage(`message-${index}`));
  const fixture = await immutableMutationFixture(context, { messages });
  await seedTerminals(fixture, messages);
  context.mock.method(ImmutableSessionStore.prototype, "entries", () =>
    assert.fail("snapshot query cannot enumerate history"),
  );
  const first = await query(fixture);
  assert.equal(first.found, true);
  const applied = decide(first.snapshot);
  assert.equal(applied.applied, true);
  fixture.service.now = () => "2026-06-17T00:00:10.000Z";
  const repeated = await query(fixture, {
    commandId: "query-2",
    knownSequence: first.snapshot.sequence,
  });
  assert.notEqual(repeated.snapshot.commandId, first.snapshot.commandId);
  assert.notEqual(repeated.snapshot.generatedAt, first.snapshot.generatedAt);
  assert.equal(repeated.snapshot.unchanged, true);
  assert.equal(decide(repeated.snapshot, applied.observation).deduplicated, true);
  const expanded = await query(fixture, { commandId: "query-3", terminalLimit: 3 });
  assert.equal(expanded.snapshot.sequence, first.snapshot.sequence);
  const wider = decide(expanded.snapshot, applied.observation);
  assert.equal(wider.applied, true);
  assert.equal(wider.observation.turns.length, 3);
  const narrowed = decide(repeated.snapshot, wider.observation);
  assert.equal(narrowed.applied, true);
  assert.equal(narrowed.observation.turns.length, 1);
});

test("replacement snapshot window omits retired turns while command projection retains explicit deletion evidence", async (context) => {
  const messages = [mutationMessage("keep"), mutationMessage("drop")];
  const fixture = await immutableMutationFixture(context, { messages });
  await seedTerminals(fixture, messages);
  const before = await query(fixture, { terminalLimit: 10 });
  const observed = decide(before.snapshot).observation;
  assert.deepEqual(
    before.snapshot.recentTerminalTurns.map((turn) => turn.turnScopeId),
    ["drop", "keep"],
  );
  const replacement = await fixture.service.replaceTurn({
    ...fixture.request,
    anchor: { turnScopeId: "drop" },
    commandId: "replace-drop",
    turnScopeId: "replacement",
    newContent: "edited",
    attachments: [],
  });
  assert.deepEqual(replacement.projection.messageSuffix, {
    firstOrdinal: 2,
    previousMessageCount: 2,
  });
  assert.ok(replacement.projection.replacements.some((entry) => entry.key === "drop"));
  context.mock.method(ImmutableSessionStore.prototype, "entries", () =>
    assert.fail("snapshot query cannot enumerate tombstones"),
  );
  const after = await query(fixture, { commandId: "reconnect", terminalLimit: 10 });
  const next = decide(after.snapshot, observed);
  assert.equal(next.applied, true);
  assert.ok(after.snapshot.sequence > before.snapshot.sequence);
  assert.equal(
    after.snapshot.recentTerminalTurns.some((turn) => turn.turnScopeId === "drop"),
    false,
  );
  assert.deepEqual(after.snapshot.replacedTurns, []);
  assert.equal(decide(before.snapshot, next.observation).reason, "stale_snapshot");
  assert.equal((await (await fixture.open()).readMessage("keep")).message.content, "keep");
});
