/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readCommittedIndex, corruptRecord } from "./helpers/immutable-record-reads.js";
import test from "node:test";
import { mkdtemp, rm, rename } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { createSessionChangesSubmission } from "@noobot/session-protocol/session-changes";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  commitImmutableSessionChanges,
  commitSessionChanges,
} from "../helpers/commit-immutable-session-fixture.js";
import { withImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { readImmutableOutboxPage } from "../../src/session/session-artifact-session/immutable-outbox.js";
import { immutableEventSequenceKey } from "../../src/session/session-artifact-session/immutable-event-changes.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

const ts = "2026-01-01T00:00:00.000Z";
async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "session-delta-"));
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
function message(uid, turnScopeId = "t1") {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId,
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: uid,
    attachments: [],
    transferEnvelopes: [],
    ts,
  };
}
function acceptance() {
  return {
    eventType: "turn.action_accepted",
    phase: "action",
    action: "send",
    sessionId: "s1",
    turnScopeId: "t1",
    dialogProcessId: "d1",
    presentationMessageId: "p1",
    commandId: "accept",
    causationId: "accept",
    executionId: "agent:t1",
    executionKind: "agent",
    rootExecutionId: "agent:t1",
  };
}
async function commit(store, changes, operationId, expectedGeneration) {
  return commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: expectedGeneration ?? (await store.snapshot()).generation,
    operationId,
    changes,
    committedAt: ts,
  });
}
async function accept(store) {
  const result = await commit(
    store,
    {
      turnTransition: acceptance(),
      messages: [message("m1")],
      sessionMetadata: { customTitle: "delta session" },
      timings: [{ turnScopeId: "t1", dialogProcessId: "d1", thinkingFinishedAt: ts }],
    },
    "accept",
  );
  return result.result.turnTransition.committedEvent;
}
function ack(record, consumerId = "websocket") {
  const { domain, scopeId, sequence } = record.envelope.ordering;
  return {
    type: "acknowledge",
    eventId: record.eventId,
    consumerId,
    orderingDomain: domain,
    orderingScopeId: scopeId,
    sequence,
    deliveredAt: ts,
  };
}

test("immutable storage rejects replacement and its mixed changes before publication", async (t) => {
  const store = await fixture(t);
  const created = await commit(store, { messages: [message("m1")] }, "create");
  const [{ contentReference, owner }] = created.result.messageReceipts;
  const before = await store.snapshot();
  const messageContentReplacements = [
    {
      messageUid: "m1",
      dialogProcessId: "d1",
      turnScopeId: "t1",
      expectedContentReference: contentReference,
      owner,
      content: "",
    },
  ];
  const unsupported = { code: "SESSION_CHANGE_UNSUPPORTED", statusCode: 409 };
  await assert.rejects(
    commit(
      store,
      { messageContentReplacements, sessionMetadata: { customTitle: "not committed" } },
      "replace",
    ),
    unsupported,
  );
  await assert.rejects(
    commit(store, { summaryCheckpoints: [{ messageContentReplacements }] }, "checkpoint"),
    unsupported,
  );
  assert.deepEqual(await store.snapshot(), before);
});

test("business delta atomically publishes messages, lifecycle, timing, metadata and a replayable result", async (t) => {
  const store = await fixture(t);
  const initial = await store.snapshot();
  const event = await accept(store);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.generation, initial.generation + 1);
  assert.equal(await store.get(initial, "messages", "m1"), null);
  assert.equal((await store.get(snapshot, "messages", "m1")).message.content, "m1");
  assert.equal((await store.get(snapshot, "metadata", "session")).customTitle, "delta session");
  assert.equal((await store.get(snapshot, "timings", "t1")).thinkingFinishedAt, ts);
  assert.equal(
    await store.get(snapshot, "eventSequences", immutableEventSequenceKey(event.envelope)),
    event.envelope.ordering.sequence,
  );
  const replay = await commit(
    store,
    {
      turnTransition: acceptance(),
      messages: [message("m1")],
      sessionMetadata: { customTitle: "delta session" },
      timings: [{ turnScopeId: "t1", dialogProcessId: "d1", thinkingFinishedAt: ts }],
    },
    "accept",
    initial.generation,
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.turnTransition.committedEvent.eventId, event.eventId);
  assert.equal((await store.snapshot()).generation, snapshot.generation);
});

test("a duplicate lifecycle command returns the same result shape without publishing", async (t) => {
  const store = await fixture(t);
  await accept(store);
  const before = await store.snapshot();
  const duplicate = await commit(store, { turnTransition: acceptance() }, "duplicate");

  assert.equal(duplicate.aborted, true);
  assert.equal(duplicate.replayed, false);
  assert.equal(duplicate.generation, before.generation);
  assert.equal(duplicate.result.turnTransition.applied, false);
  assert.equal(duplicate.result.turnTransition.deduplicated, true);
  assert.deepEqual(await store.snapshot(), before);
});

test("outbox acknowledgements affect only the named consumer and retain old snapshot visibility", async (t) => {
  const store = await fixture(t);
  const event = await accept(store);
  const before = await store.snapshot();
  await commit(
    store,
    {
      deliveries: [
        { type: "attempt", eventId: event.eventId, consumerId: "websocket", attemptedAt: ts },
        ack(event),
      ],
    },
    "delivery",
  );
  const after = await store.snapshot();
  const page = (snapshot, consumerId) =>
    readImmutableOutboxPage({ store, snapshot, consumerId, limit: 1 });
  assert.equal((await page(before, "websocket")).events.length, 1);
  assert.equal((await page(after, "websocket")).events.length, 0);
  const other = await page(after, "audit");
  assert.equal(other.events.length, 1);
  assert.equal(other.cursor, 1);
  assert.equal(other.hasMore, false);
  const delivery = (await store.get(after, "outbox", event.eventId)).deliveries.websocket;
  assert.equal(delivery.attempts, 1);
  assert.equal(delivery.deliveredAt, ts);
  await assert.rejects(
    commit(store, { deliveries: [{ ...ack(event), sequence: 999 }] }, "invalid-ack"),
    {
      code: "AUTHORITY_OUTBOX_INTEGRITY_INVALID",
    },
  );
  assert.equal((await store.snapshot()).generation, after.generation);
});

test("a failed delta publishes neither business data nor outbox and retry keeps stable event identity", async (t) => {
  const store = await fixture(t);
  const initial = await store.snapshot();
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("injected head failure"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(accept(store), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), initial);
  assert.equal(await store.get(initial, "messages", "m1"), null);
  await accept(store);
  assert.equal((await store.snapshot()).generation, initial.generation + 1);
});

test("unknown and invalid changes never publish a partially prepared graph", async (t) => {
  const store = await fixture(t);
  const initial = await store.snapshot();
  await assert.rejects(
    commit(store, { messages: [message("m1")], sessionMetadata: { messages: [] } }, "invalid"),
    TypeError,
  );
  await assert.rejects(commit(store, { completeSession: {} }, "full-session"), TypeError);
  await assert.rejects(commit(store, { artifactEvents: {} }, "invalid-events"), TypeError);
  assert.deepEqual(await store.snapshot(), initial);
});

test("commit boundary rejects unsupported request fields without publishing state", async (t) => {
  const store = await fixture(t);
  const initial = await store.snapshot();
  await assert.rejects(
    commitSessionChanges({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      expectedGeneration: initial.generation,
      operationId: "invalid-envelope",
      committedAt: ts,
      changes: { messages: [message("m1")] },
      generation: undefined,
    }),
    TypeError,
  );
  assert.deepEqual(await store.snapshot(), initial);
});

test("non-JSON changes are rejected before scope validation and publication", async (t) => {
  const store = await fixture(t);
  const initial = await store.snapshot();
  let scopeValidated = false;
  await assert.rejects(
    commitSessionChanges({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      expectedGeneration: initial.generation,
      operationId: "invalid-delta",
      committedAt: ts,
      changes: { messages: [message("m1")], completeSession: undefined },
      validateSnapshot: () => {
        scopeValidated = true;
      },
    }),
    /require finite JSON values/,
  );
  assert.equal(scopeValidated, false);
  assert.deepEqual(await store.snapshot(), initial);
});

test("scoped commit rejects unknown fields instead of stripping them before protocol validation", async (t) => {
  const store = await fixture(t);
  const initial = await store.snapshot();
  await withImmutableSessionReader(
    { sessionDir: store.sessionDir, sessionId: store.sessionId, parentSessionId: "" },
    async (reader, submit) => {
      await assert.rejects(
        submit({
          expectedGeneration: reader.generation,
          operationId: "scoped-invalid-envelope",
          committedAt: ts,
          changes: { messages: [message("m1")] },
          generation: undefined,
        }),
        TypeError,
      );
    },
  );
  assert.deepEqual(await store.snapshot(), initial);
});

test("scoped submission passes the same captured input through commit and replay", async (t) => {
  const store = await fixture(t);
  const submission = createSessionChangesSubmission();
  const transact = ImmutableSessionStore.prototype.transact;
  let input;
  let preparations = 0;
  let transactions = 0;
  t.mock.method(ImmutableSessionStore.prototype, "transact", function (options) {
    assert.ok(input);
    assert.equal(options.input, input);
    transactions += 1;
    return transact.call(this, options);
  });
  const run = () =>
    withImmutableSessionReader(
      { sessionDir: store.sessionDir, sessionId: store.sessionId, parentSessionId: "" },
      (reader, submit) =>
        submission.submit({
          userId: "u1",
          sessionId: store.sessionId,
          prepare: () => {
            preparations += 1;
            return reader.prepareRequest({
              operationId: "scoped-captured-input",
              changes: { messages: [message("m1")] },
              committedAt: ts,
            });
          },
          commit: (request) => {
            const captured = request.input;
            if (input) assert.equal(captured, input);
            input = captured;
            return submit(request);
          },
        }),
    );
  const committed = await run();
  assert.equal(committed.replayed, false);
  assert.deepEqual(await run(), { ...committed, replayed: true });
  assert.equal(preparations, 1);
  assert.equal(transactions, 2);
});

test("message receipts use the prepared commit and read its record only once on replay", async (t) => {
  const store = await fixture(t);
  const request = {
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "reuse-message-receipt-commit",
    committedAt: ts,
    changes: { messages: [message("m1")] },
  };
  const read = t.mock.method(store, "readCommitRecord");
  const first = await commitImmutableSessionChanges(store, request);
  assert.equal(first.result.messageReceipts[0].messageUid, "m1");
  assert.equal(read.mock.callCount(), 0);
  assert.deepEqual(await commitImmutableSessionChanges(store, request), {
    ...first,
    replayed: true,
  });
  assert.equal(read.mock.callCount(), 1);
});

test("commit validation and retry use the request captured before scope validation", async (t) => {
  const store = await fixture(t);
  const initial = await store.snapshot();
  const request = {
    expectedGeneration: initial.generation,
    operationId: "captured-business-delta",
    committedAt: ts,
    changes: { messages: [message("m1")] },
  };
  const original = structuredClone(request);
  const first = await commitImmutableSessionChanges(store, request, () => {
    request.changes.completeSession = undefined;
    request.changes.messages[0].content = "changed after capture";
  });
  const current = await store.snapshot();
  assert.equal((await store.get(current, "messages", "m1")).message.content, "m1");
  const replay = await commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    ...original,
  });
  assert.deepEqual(replay, { ...first, replayed: true });
  let scopeValidated = false;
  await assert.rejects(
    commitSessionChanges({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      ...original,
      changes: { ...original.changes, completeSession: null },
      validateSnapshot: () => {
        scopeValidated = true;
      },
    }),
    /Unsupported session change: completeSession/,
  );
  assert.equal(scopeValidated, true);
  assert.deepEqual(await store.snapshot(), current);
});

test("cold deltas never load unrelated message bodies and outbox pages bound scanned positions", async (t) => {
  const store = await fixture(t);
  await accept(store);
  await commit(
    store,
    {
      messages: Array.from({ length: 96 }, (_, i) => message(`history-${i}`, `history-turn-${i}`)),
    },
    "history",
  );
  const previous = await store.snapshot();
  const root = await readCommittedIndex(store, previous.root, "messages");
  for (let i = 0; i < 96; i++) {
    const reference = await readCommittedIndex(store, root, `history-${i}`);
    await corruptRecord(store, reference);
  }
  const reopened = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  const { work } = await observeSessionStorageWork(() =>
    commit(reopened, { messages: [message("current")] }, "current"),
  );
  assert.ok(work.immutableIndexPageReads < 100, JSON.stringify(work));
  assert.ok(work.immutableHeadWriteBytes < 4096, JSON.stringify(work));
  const page = await readImmutableOutboxPage({
    store: reopened,
    snapshot: await reopened.snapshot(),
    consumerId: "websocket",
    limit: 1,
  });
  assert.equal(page.events.length, 1);
});

test("durable outbox progress publishes with acknowledgement and resumes independently for each consumer", async (t) => {
  const store = await fixture(t);
  const event = await accept(store);
  const before = await store.snapshot();
  const delta = {
    deliveries: [ack(event)],
    outboxCursors: [{ consumerId: "websocket", expectedCursor: 0, cursor: 1 }],
  };
  await commit(store, delta, "advance", before.generation);
  assert.equal((await commit(store, delta, "advance", before.generation)).replayed, true);
  const reopened = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  const current = await reopened.snapshot();
  const read = (snapshot, consumerId) =>
    readImmutableOutboxPage({ store: reopened, snapshot, consumerId });
  assert.equal((await read(current, "websocket")).events.length, 0);
  assert.equal((await read(current, "websocket")).cursor, 1);
  assert.equal((await read(current, "audit")).events.length, 1);
  assert.equal((await read(before, "websocket")).events.length, 1);
  await assert.rejects(commit(store, { outboxCursors: delta.outboxCursors }, "stale-cursor"), {
    code: "SESSION_OUTBOX_CURSOR_CONFLICT",
  });
});

test("outbox cursor cannot skip undelivered events, regress, exceed the head or advance an unbounded range", async (t) => {
  const store = await fixture(t);
  await accept(store);
  const before = await store.snapshot();
  await assert.rejects(
    commit(
      store,
      { outboxCursors: [{ consumerId: "websocket", expectedCursor: 0, cursor: 1 }] },
      "skip",
    ),
    {
      code: "SESSION_OUTBOX_CURSOR_UNDELIVERED",
    },
  );
  for (const update of [
    { consumerId: "websocket", expectedCursor: 1, cursor: 0 },
    { consumerId: "websocket", expectedCursor: 0, cursor: 2 },
    { consumerId: "websocket", expectedCursor: 0, cursor: 257 },
    { consumerId: " websocket", expectedCursor: 0, cursor: 0 },
  ])
    await assert.rejects(commit(store, { outboxCursors: [update] }, "invalid-cursor"), TypeError);
  assert.deepEqual(await store.snapshot(), before);
});

test("failed outbox progress preserves redelivery and a retried head publishes acknowledgement and cursor together", async (t) => {
  const store = await fixture(t);
  const event = await accept(store);
  const before = await store.snapshot();
  const delta = {
    deliveries: [ack(event)],
    outboxCursors: [{ consumerId: "websocket", expectedCursor: 0, cursor: 1 }],
  };
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("cursor publication fault"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(commit(store, delta, "advance", before.generation), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), before);
  assert.equal(
    (await readImmutableOutboxPage({ store, snapshot: before, consumerId: "websocket" })).events
      .length,
    1,
  );
  await commit(store, delta, "advance", before.generation);
  assert.deepEqual(await store.get(await store.snapshot(), "outboxConsumers", "websocket"), {
    consumerId: "websocket",
    cursor: 1,
  });
});
