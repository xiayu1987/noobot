/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { parseAuthorityOutboxTurnRemoval } from "@noobot/event-protocol/outbox";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { readImmutableOutboxPage } from "../../src/session/session-artifact-session/immutable-outbox.js";
import { upgradeImmutableOutboxIndexes } from "../../src/session/session-artifact-session/immutable-outbox-index-upgrade.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { collectValueRecords, forbidRecordReads } from "./helpers/immutable-record-reads.js";

const ts = "2026-01-01T00:00:00.000Z";
async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "outbox-turn-removal-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
}
async function commit(store, changes, operationId, generation) {
  return commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    changes,
    operationId,
    expectedGeneration: generation ?? (await store.snapshot()).generation,
    committedAt: ts,
  });
}
async function accept(store, scope) {
  const result = await commit(
    store,
    {
      turnTransition: {
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        sessionId: "s1",
        turnScopeId: scope,
        dialogProcessId: `dialog:${scope}`,
        presentationMessageId: `p:${scope}`,
        commandId: `accept:${scope}`,
        causationId: `accept:${scope}`,
        executionId: `agent:${scope}`,
        executionKind: "agent",
        rootExecutionId: `agent:${scope}`,
      },
    },
    `accept:${scope}`,
  );
  assert.equal(result.result.turnTransition?.applied, true, JSON.stringify(result));
  return result.result.turnTransition.committedEvent;
}
async function complete(store, scope) {
  for (const [eventType, phase, extra] of [
    ["turn.processing_started", "processing", {}],
    ["turn.processing_completed", "completion", { completionCommitId: `completed:${scope}` }],
    [
      "turn.completed",
      "completion",
      { commandId: `completed:${scope}`, terminalStatus: { command: "completed" } },
    ],
  ]) {
    const result = await commit(
      store,
      {
        turnTransition: {
          eventType,
          phase,
          sessionId: "s1",
          turnScopeId: scope,
          commandId: `${eventType}:${scope}`,
          causationId: `${eventType}:${scope}`,
          ...extra,
        },
      },
      `${eventType}:${scope}`,
    );
    assert.equal(result.result.turnTransition?.applied, true, JSON.stringify(result));
  }
}
const page = (store, snapshot) =>
  readImmutableOutboxPage({ store, snapshot, consumerId: "client" });

test("outbox removal protocol rejects ambiguous, duplicate and noncanonical scopes", () => {
  for (const source of [
    null,
    {},
    [],
    { turnScopeIds: [] },
    { turnScopeIds: [""] },
    { turnScopeIds: [" t1"] },
    { turnScopeIds: ["t1", "t1"] },
    { turnScopeIds: ["t1"], extra: true },
  ])
    assert.throws(() => parseAuthorityOutboxTurnRemoval(source), TypeError);
  const source = { turnScopeIds: ["t1", "t2"] };
  assert.deepEqual(parseAuthorityOutboxTurnRemoval(source), source);
  assert.notEqual(parseAuthorityOutboxTurnRemoval(source).turnScopeIds, source.turnScopeIds);
});

test("scope removal publishes with metadata and cursor, preserves old readers and replays after restart", async (t) => {
  const store = await fixture(t);
  const removedEvent = await accept(store, "t1");
  await complete(store, "t1");
  const retainedEvent = await accept(store, "t2");
  const before = await store.snapshot();
  const delta = {
    outboxTurnRemoval: { turnScopeIds: ["t1"] },
    sessionMetadata: { customTitle: "removed" },
    outboxCursors: [{ consumerId: "client", expectedCursor: 0, cursor: 4 }],
  };
  const result = await commit(store, delta, "remove", before.generation);
  assert.deepEqual(result.result.outboxTurnRemoval, { removed: 4 });
  const after = await store.snapshot();
  assert.equal(after.generation, before.generation + 1);
  assert.equal((await page(store, before)).events.length, 5);
  assert.deepEqual(
    (await page(store, after)).events.map((event) => event.eventId),
    [retainedEvent.eventId],
  );
  assert.equal(await store.get(after, "outbox", removedEvent.eventId), null);
  assert.equal(await store.get(after, "turnOutbox", "t1"), null);
  assert.equal((await store.get(after, "turnOutbox", "t2")).count, 1);
  assert.equal((await store.get(after, "metadata", "session")).customTitle, "removed");
  assert.notEqual(await store.get(after, "events", removedEvent.eventId), null);
  const reopened = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  assert.deepEqual(await commit(reopened, delta, "remove", before.generation), {
    ...result,
    replayed: true,
  });
  assert.deepEqual(await reopened.snapshot(), after);
});

test("failed scope removal publishes no partial metadata, index, outbox or cursor changes", async (t) => {
  const store = await fixture(t);
  await accept(store, "t1");
  const before = await store.snapshot();
  const delta = {
    outboxTurnRemoval: { turnScopeIds: ["t1"] },
    sessionMetadata: { customTitle: "removed" },
    outboxCursors: [{ consumerId: "client", expectedCursor: 0, cursor: 1 }],
  };
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("injected publication failure"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(commit(store, delta, "remove", before.generation), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), before);
  assert.equal((await page(store, before)).events.length, 1);
  assert.equal(await store.get(before, "outboxConsumers", "client"), null);
  assert.equal((await store.get(before, "turnOutbox", "t1")).count, 1);
  await commit(store, delta, "remove", before.generation);
  assert.equal((await page(store, await store.snapshot())).events.length, 0);
});

test("cold scope removal never accesses unrelated historical event or outbox bodies", async (t) => {
  const store = await fixture(t);
  const first = await accept(store, "t1");
  await complete(store, "t1");
  await accept(store, "t2");
  const before = await store.snapshot();
  const references = await store.objects.withSnapshot(before, async () => {
    const records = new Set();
    for (const collection of ["outbox", "events"]) {
      const root = await store.index.get(before.root, collection);
      const reference = await store.index.get(root, first.eventId);
      await collectValueRecords(store, reference, records);
    }
    return records;
  });
  setFsAdapter(await forbidRecordReads(store, references));
  t.after(resetFsAdapter);
  const reopened = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  assert.deepEqual(
    (await commit(reopened, { outboxTurnRemoval: { turnScopeIds: ["t2"] } }, "remove")).result
      .outboxTurnRemoval,
    { removed: 1 },
  );
});

test("missing index requires an explicit offline rebuild and completed rebuilds do not scan history", async (t) => {
  const store = await fixture(t);
  await accept(store, "t1");
  const before = await store.snapshot();
  await store.commit({
    expectedGeneration: before.generation,
    operationId: "old-index",
    changes: [
      { collection: "metadata", key: "events", value: { sequence: 1 } },
      { collection: "turnOutbox", key: "t1", remove: true },
    ],
  });
  const old = await store.snapshot();
  await assert.rejects(commit(store, { outboxTurnRemoval: { turnScopeIds: ["t1"] } }, "remove"), {
    code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
  });
  assert.deepEqual(await store.snapshot(), old);
  const options = { sessionDir: store.sessionDir, sessionId: store.sessionId };
  assert.equal((await upgradeImmutableOutboxIndexes(options)).result.upgraded, true);
  const rebuilt = await store.snapshot();
  assert.equal((await store.get(rebuilt, "turnOutbox", "t1")).count, 1);
  assert.equal((await upgradeImmutableOutboxIndexes(options)).result.upgraded, false);
  assert.deepEqual(await store.snapshot(), rebuilt);
  await commit(store, { outboxTurnRemoval: { turnScopeIds: ["t1"] } }, "remove");
  assert.equal((await page(store, await store.snapshot())).events.length, 0);
});

test("corrupt scope membership aborts all changes instead of silently retaining dangling entries", async (t) => {
  const store = await fixture(t);
  await accept(store, "t1");
  const snapshot = await store.snapshot();
  const descriptor = await store.get(snapshot, "turnOutbox", "t1");
  await store.commit({
    expectedGeneration: snapshot.generation,
    operationId: "corrupt-count",
    changes: [{ collection: "turnOutbox", key: "t1", value: { ...descriptor, count: 2 } }],
  });
  const before = await store.snapshot();
  await assert.rejects(
    commit(
      store,
      {
        outboxTurnRemoval: { turnScopeIds: ["t1"] },
        sessionMetadata: { customTitle: "must not publish" },
      },
      "remove",
    ),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  assert.deepEqual(await store.snapshot(), before);
});
