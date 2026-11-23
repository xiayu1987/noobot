/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { readImmutableDisplayProjection } from "../../src/session/session-artifact-session/immutable-display-projection.js";
import { openSessionArtifactReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { exportImmutableSession } from "../../src/session/session-artifact-session/immutable-session-export.js";
import { buildSessionDisplayProjection } from "../../src/session/session-summary-builders/session-display-summary.js";
import { registerDialogOrderMessage } from "../../src/session/entities/dialog-order-entity.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "display-projection-integrity-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const ts = "2026-01-01T00:00:00.000Z";
  const messages = [
    { role: "user", messageOrigin: "natural", content: "visible" },
    { role: "assistant", chatPresentation: false, content: "hidden".repeat(20000) },
  ].map((message, index) => ({
    messageUid: `m${index}`,
    ...(message.role === "user"
      ? { userMessageId: `u${index}` }
      : {
          modelMessageId: `model-${index}`,
          presentationMessageId: `presentation-${index}`,
        }),
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    type: "message",
    attachments: [],
    ts,
    ...message,
  }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages,
      dialogOrder: messages.reduce(registerDialogOrderMessage, []),
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
  return { sessionDir, store, snapshot: await store.snapshot() };
}

test("display uses validated metadata without materializing suppressed content and equals export projection", async (t) => {
  const { store, snapshot } = await fixture(t);
  const expected = buildSessionDisplayProjection(await exportImmutableSession({ store, snapshot }));
  const materialize = store.objects.materializeValues.bind(store.objects);
  const selected = [];
  t.mock.method(store.objects, "materializeValues", async (records) => {
    for (const metadata of records)
      if (metadata.value?.message) selected.push(metadata.value.message.messageUid);
    return materialize(records);
  });
  assert.deepEqual(await readImmutableDisplayProjection({ store, snapshot }), {
    ...expected,
    messages: [{ ...expected.messages[0], sessionOrdinal: 1 }],
  });
  assert.deepEqual(selected, ["m0"]);
});

test("display source pages retain global order and skip suppressed bodies within their byte budget", async (t) => {
  const { sessionDir, store, snapshot } = await fixture(t);
  await using reader = await openSessionArtifactReader({ sessionDir });
  const first = await reader.readDisplaySourcePage({ cursor: null, limit: 1 });
  const metadata = await reader.readMetadata();
  await store.transact({
    expectedGeneration: reader.generation,
    operationId: "advance-display-snapshot",
    input: { customTitle: "New title" },
    prepare: async () => ({
      changes: [
        {
          collection: "metadata",
          key: "session",
          value: { ...metadata, customTitle: "New title" },
        },
      ],
    }),
  });
  await using latest = await openSessionArtifactReader({ sessionDir });
  assert.ok(latest.generation > snapshot.generation);
  await assert.rejects(latest.readDisplaySourcePage({ cursor: first.nextCursor }), {
    code: "SESSION_PAGE_CURSOR_CONFLICT",
  });
  const second = await reader.readDisplaySourcePage({
    cursor: first.nextCursor,
    limit: 1,
    maxBytes: 4096,
  });
  assert.equal(first.generation, second.generation);
  assert.equal(first.messageCount, 2);
  assert.equal(second.nextCursor, null);
  const records = [...first.records, ...second.records];
  assert.deepEqual(
    records.map(({ ordinal, message }) => [ordinal, message.messageUid]),
    [
      [1, "m0"],
      [2, "m1"],
    ],
  );
  await assert.rejects(reader.readMessagePage({ cursor: first.nextCursor }), {
    code: "SESSION_PAGE_CURSOR_CONFLICT",
  });
  await assert.rejects(reader.readDisplaySourcePage({ cursor: first.nextCursor, maxBytes: 1 }), {
    code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
  });
  const { messages, ...source } = await reader.exportSession();
  const timelines = new Map(records.map(({ message, display }) => [message, display.toolTimeline]));
  const fromPages = buildSessionDisplayProjection(
    { ...source, messages: records.map(({ message }) => message) },
    { selectToolTimeline: (message) => timelines.get(message) },
  );
  assert.deepEqual(await reader.readDisplayProjection(), {
    ...fromPages,
    messages: [{ ...fromPages.messages[0], sessionOrdinal: 1 }],
  });
});

for (const [overrides, error] of [
  [
    { attachments: {} },
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID", message: "Invalid immutable message entity" },
  ],
  [
    { resourceRefs: [{}] },
    { name: "TypeError", message: "unsupported resource reference version" },
  ],
  [{ mutationRefs: [{}] }, { name: "TypeError", message: "invalid file mutation reference" }],
  [{ transferEnvelopes: [{}] }, { message: "invalid_transfer_envelope:invalid_protocol" }],
  [
    { ts: "invalid" },
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID", message: "Invalid immutable message entity" },
  ],
]) {
  test(`display rejects invalid suppressed metadata ${Object.keys(overrides)[0]}`, async (t) => {
    const { store, snapshot } = await fixture(t);
    const record = await store.get(snapshot, "messages", "m1");
    await store.transact({
      expectedGeneration: snapshot.generation,
      operationId: "corrupt",
      input: overrides,
      prepare: async () => ({
        changes: [
          {
            collection: "messages",
            key: "m1",
            value: { ...record, message: { ...record.message, ...overrides } },
          },
        ],
      }),
    });
    await assert.rejects(
      readImmutableDisplayProjection({ store, snapshot: await store.snapshot() }),
      error,
    );
    await readImmutableDisplayProjection({ store, snapshot });
  });
}

for (const content of [null, {}, 42]) {
  test(`display rejects materialized nonstring content ${JSON.stringify(content)}`, async (t) => {
    const { store, snapshot } = await fixture(t);
    const record = await store.get(snapshot, "messages", "m0");
    await store.transact({
      expectedGeneration: snapshot.generation,
      operationId: "corrupt",
      input: content,
      prepare: async () => ({
        changes: [
          {
            collection: "messages",
            key: "m0",
            value: { ...record, message: { ...record.message, content } },
          },
        ],
      }),
    });
    await assert.rejects(
      readImmutableDisplayProjection({ store, snapshot: await store.snapshot() }),
      {
        code: "SESSION_MESSAGE_ENTITY_INVALID",
        validationErrors: ["content_not_string"],
      },
    );
  });
}
