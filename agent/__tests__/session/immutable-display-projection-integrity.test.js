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
  return { store, snapshot: await store.snapshot() };
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
  assert.deepEqual(await readImmutableDisplayProjection({ store, snapshot }), expected);
  assert.deepEqual(selected, ["m0"]);
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
