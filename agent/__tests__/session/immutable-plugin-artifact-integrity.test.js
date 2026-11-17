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
import {
  createPluginArtifactEnvelope,
  pluginArtifactKey,
} from "@noobot/event-protocol/plugin-artifact-event";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { openImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";

const ts = "2026-01-01T00:00:00.000Z";
const identity = { pluginId: "example", artifactType: "document", artifactId: "document-1" };
const key = pluginArtifactKey(identity);
const openReader = (store) =>
  openImmutableSessionReader({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    parentSessionId: "",
  });

function artifactEvent(replaced = false) {
  const envelope = structuredClone(
    createPluginArtifactEnvelope({
      ...identity,
      sessionId: "s1",
      turnScopeId: "t1",
      sequence: replaced ? 2 : 1,
      revision: replaced ? 2 : 1,
      operation: replaced ? "replaced" : "created",
      baseRevision: replaced ? 1 : null,
      data: { title: replaced ? "replacement" : "original" },
      occurredAt: ts,
    }),
  );
  envelope.ordering.aggregateVersion = replaced ? 2 : 1;
  return { eventId: envelope.identity.eventId, envelope, committedAt: ts, deliveries: {} };
}

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "plugin-artifact-integrity-"));
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
    operationId: "create-artifact",
    committedAt: ts,
    changes: { artifactEvents: [artifactEvent()] },
  });
  return store;
}

const corruptions = [
  [
    "plugin owner",
    (value) => {
      value.pluginId = "foreign";
    },
  ],
  [
    "artifact type",
    (value) => {
      value.artifactType = "foreign";
    },
  ],
  [
    "artifact identity",
    (value) => {
      value.artifactId = "foreign";
    },
  ],
  [
    "missing data",
    (value) => {
      delete value.data;
    },
  ],
  [
    "invalid data",
    (value) => {
      value.data = "invalid";
    },
  ],
  [
    "missing event",
    (value) => {
      delete value.eventId;
    },
  ],
  [
    "missing operation",
    (value) => {
      delete value.operation;
    },
  ],
  [
    "invalid operation",
    (value) => {
      value.operation = "appended";
    },
  ],
  [
    "created revision",
    (value) => {
      value.operation = "replaced";
    },
  ],
  [
    "invalid revision",
    (value) => {
      value.revision = "1";
    },
  ],
];

for (const [name, corrupt] of corruptions) {
  test(`plugin artifact query and replacement reject hash-valid invalid ${name}`, async (t) => {
    const store = await fixture(t);
    await using previous = await openReader(store);
    const original = await previous.readPluginArtifact(identity);
    const value = structuredClone(original);
    corrupt(value);
    await store.transact({
      expectedGeneration: (await store.snapshot()).generation,
      operationId: "corrupt",
      input: {},
      prepare: async () => ({ changes: [{ collection: "pluginArtifacts", key, value }] }),
    });
    const before = await store.snapshot();
    const isCorruption = (error) =>
      error.code === "SESSION_IMMUTABLE_STORAGE_INVALID" && error.cause instanceof TypeError;
    await t.test("query rejects", async () => {
      await using reader = await openReader(store);
      await assert.rejects(reader.readPluginArtifact(identity), isCorruption);
    });
    await t.test("replacement refuses to overwrite corruption", async () => {
      await assert.rejects(
        commitSessionChanges({
          sessionDir: store.sessionDir,
          sessionId: store.sessionId,
          expectedGeneration: before.generation,
          operationId: "replace-artifact",
          committedAt: ts,
          changes: {
            artifactEvents: [artifactEvent(true)],
            sessionMetadata: { title: "not published" },
          },
        }),
        isCorruption,
      );
    });
    assert.deepEqual(await store.snapshot(), before);
    assert.deepEqual(await previous.readPluginArtifact(identity), original);
  });
}

test("plugin artifact lookup is local and keeps explicit missing semantics", async (t) => {
  const store = await fixture(t);
  await using reader = await openReader(store);
  const calls = [];
  const get = ImmutableSessionStore.prototype.get;
  t.mock.method(ImmutableSessionStore.prototype, "get", async function (...args) {
    calls.push(args);
    return get.apply(this, args);
  });
  assert.equal((await reader.readPluginArtifact(identity)).data.title, "original");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(1), ["pluginArtifacts", key]);
  assert.equal(await reader.readPluginArtifact({ ...identity, artifactId: "missing" }), null);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], calls[1][0]);
});
