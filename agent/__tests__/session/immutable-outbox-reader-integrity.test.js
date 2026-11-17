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
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import {
  readImmutableOutboxEvent,
  readImmutableOutboxPage,
} from "../../src/session/session-artifact-session/immutable-outbox.js";
import { openImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";

const ts = "2026-01-01T00:00:00.000Z";
async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "outbox-reader-integrity-"));
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
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  await commitSessionChanges({
    sessionDir,
    sessionId: "s1",
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "accept",
    committedAt: ts,
    changes: {
      turnTransition: {
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
      },
    },
  });
  return store;
}
const page = (store, snapshot) =>
  readImmutableOutboxPage({ store, snapshot, consumerId: "client" });

const corruptions = [
  ...["orderingDomain", "orderingScopeId", "sequence"].flatMap((field) =>
    ["client", "other"].map((consumerId) => [
      `${consumerId} acknowledgement ${field}`,
      (item) => {
        item.deliveries[consumerId] = {
          ...item.deliveries.client,
          [field]: field === "sequence" ? item.envelope.ordering.sequence + 1 : "foreign",
        };
      },
    ]),
  ),
  [
    "envelope event identity",
    (item) => {
      item.envelope.identity.eventId = "wrong";
    },
  ],
  [
    "missing commit time",
    (item) => {
      delete item.committedAt;
    },
  ],
  [
    "invalid commit time",
    (item) => {
      item.committedAt = "invalid";
    },
  ],
  [
    "missing envelope",
    (item) => {
      delete item.envelope;
    },
  ],
  [
    "unrelated consumer delivery",
    (item) => {
      item.deliveries.other = { attempts: -1 };
    },
  ],
];
for (const [name, corrupt] of corruptions) {
  test(`outbox reads and cursor advances reject hash-valid invalid ${name}`, async (t) => {
    const store = await fixture(t);
    const before = await store.snapshot();
    const [item] = (await page(store, before)).events;
    const ordering = { ...item.envelope.ordering };
    await using previousReader = await openImmutableSessionReader({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      parentSessionId: "",
    });

    item.deliveries.client = {
      status: "delivered",
      attempts: 1,
      lastAttemptAt: ts,
      deliveredAt: ts,
      orderingDomain: item.envelope.ordering.domain,
      orderingScopeId: item.envelope.ordering.scopeId,
      sequence: item.envelope.ordering.sequence,
    };
    corrupt(item);
    await store.commit({
      expectedGeneration: before.generation,
      operationId: "corrupt",
      changes: [{ collection: "outbox", key: item.eventId, value: item }],
    });
    const current = await store.snapshot();
    const invalid = (error) => {
      assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
      assert.equal(error.cause?.code, "AUTHORITY_OUTBOX_INTEGRITY_INVALID");
      return true;
    };
    await assert.rejects(page(store, current), invalid);
    await using reader = await openImmutableSessionReader({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      parentSessionId: "",
    });
    await assert.rejects(reader.readOutboxEvent(item.eventId), invalid);
    assert.equal((await previousReader.readOutboxEvent(item.eventId)).eventId, item.eventId);
    for (const type of ["attempt", "acknowledge"]) {
      await assert.rejects(
        commitSessionChanges({
          sessionDir: store.sessionDir,
          sessionId: store.sessionId,
          expectedGeneration: current.generation,
          operationId: type,
          committedAt: ts,
          changes: {
            sessionMetadata: { customTitle: "must not publish" },
            deliveries: [
              {
                type,
                eventId: item.eventId,
                consumerId: "client",
                attemptedAt: ts,
                deliveredAt: ts,
                orderingDomain: ordering.domain,
                orderingScopeId: ordering.scopeId,
                sequence: ordering.sequence,
              },
            ],
          },
        }),
        invalid,
      );
      assert.deepEqual(await store.snapshot(), current);
    }
    await assert.rejects(
      commitSessionChanges({
        sessionDir: store.sessionDir,
        sessionId: store.sessionId,
        expectedGeneration: current.generation,
        operationId: "advance",
        committedAt: ts,
        changes: {
          sessionMetadata: { customTitle: "must not publish" },
          outboxCursors: [{ consumerId: "client", expectedCursor: 0, cursor: 1 }],
        },
      }),
      invalid,
    );
    await assert.rejects(
      commitSessionChanges({
        sessionDir: store.sessionDir,
        sessionId: store.sessionId,
        expectedGeneration: current.generation,
        operationId: "compact",
        committedAt: ts,
        changes: {
          sessionMetadata: { customTitle: "must not publish" },
          outboxMaintenance: { retainDeliveredAfter: "2026-01-02T00:00:00.000Z" },
        },
      }),
      invalid,
    );
    assert.deepEqual(await store.snapshot(), current);
    assert.equal(await store.get(current, "outboxConsumers", "client"), null);
    assert.equal((await page(store, before)).events.length, 1);
  });
}

test("outbox pagination validates only the requested fixed-snapshot positions", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const calls = [];
  const originalGet = store.get.bind(store);
  store.get = (head, collection, key) => {
    assert.equal(head, snapshot);
    calls.push([collection, key]);
    return originalGet(head, collection, key);
  };
  const originalGetMany = store.getMany.bind(store);
  store.getMany = (head, collection, keys) => {
    assert.equal(head, snapshot);
    for (const key of keys) calls.push([collection, key]);
    return originalGetMany(head, collection, keys);
  };
  const result = await readImmutableOutboxPage({
    store,
    snapshot,
    consumerId: "client",
    after: 0,
    limit: 1,
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.cursor, 1);
  assert.equal(result.hasMore, false);
  assert.deepEqual(
    calls.map(([collection]) => collection),
    ["metadata", "eventOrder", "outbox"],
  );
});

test("outbox identity lookup reads one fixed-snapshot entry and preserves absence", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const [item] = (await page(store, snapshot)).events;
  const calls = [];
  const originalGet = store.get.bind(store);
  store.get = (head, collection, key) => {
    assert.equal(head, snapshot);
    calls.push([collection, key]);
    return originalGet(head, collection, key);
  };
  const result = await readImmutableOutboxEvent(store, snapshot, item.eventId);
  assert.equal(result.eventId, item.eventId);
  assert.deepEqual(calls, [["outbox", item.eventId]]);
  calls.length = 0;
  assert.equal(await readImmutableOutboxEvent(store, snapshot, "absent"), null);
  assert.deepEqual(calls, [["outbox", "absent"]]);
  assert.deepEqual(await store.snapshot(), snapshot);
});

for (const kind of ["event key", "session identity"]) {
  test(`outbox reads and deliveries reject a valid event with foreign ${kind}`, async (t) => {
    const store = await fixture(t);
    const before = await store.snapshot();
    const [item] = (await page(store, before)).events;
    const eventId = item.eventId;
    if (kind === "event key") {
      item.eventId = "foreign-event";
      item.envelope.identity.eventId = item.eventId;
    } else item.envelope.identity.sessionId = "foreign-session";
    await store.commit({
      expectedGeneration: before.generation,
      operationId: "foreign-event",
      changes: [{ collection: "outbox", key: eventId, value: item }],
    });
    const current = await store.snapshot();
    const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };
    await using reader = await openImmutableSessionReader({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      parentSessionId: "",
    });
    await assert.rejects(reader.readOutboxEvent(eventId), invalid);
    await assert.rejects(page(store, current), invalid);
    for (const type of ["attempt", "acknowledge"]) {
      await assert.rejects(
        commitSessionChanges({
          sessionDir: store.sessionDir,
          sessionId: store.sessionId,
          expectedGeneration: current.generation,
          operationId: type,
          committedAt: ts,
          changes: {
            sessionMetadata: { customTitle: "must not publish" },
            deliveries: [
              {
                type,
                eventId,
                consumerId: "client",
                attemptedAt: ts,
                deliveredAt: ts,
                orderingDomain: item.envelope.ordering.domain,
                orderingScopeId: item.envelope.ordering.scopeId,
                sequence: item.envelope.ordering.sequence,
              },
            ],
          },
        }),
        invalid,
      );
      assert.deepEqual(await store.snapshot(), current);
    }
  });
}
