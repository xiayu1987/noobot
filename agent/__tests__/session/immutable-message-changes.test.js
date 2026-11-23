/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import {
  readCommittedIndex,
  readCommittedValue,
  readCommittedValueMetadata,
  collectValueRecords,
  forbidRecordReads,
} from "./helpers/immutable-record-reads.js";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { SESSION_AUTO_TITLE_MAX_LENGTH } from "@noobot/session-protocol";
import { projectMessagePersistenceChange } from "@noobot/session-protocol/session-changes";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { readImmutableSessionAutoTitle } from "../../src/session/session-artifact-session/immutable-message-range.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { registerImmutableMessageBodyStorageTests } from "../helpers/immutable-message-body-storage-cases.js";
import { timestamp, message, fixture, append } from "./immutable-message-changes.test-helpers.js";

test("ordinary commits cannot write or remove existing user message attachments", async (t) => {
  const store = await fixture(t);
  const attachment = {
    attachmentId: "upload",
    attachmentSource: "user",
    sessionId: store.sessionId,
    name: "input.txt",
    mimeType: "text/plain",
  };
  const user = message("bound", { attachments: [attachment] });
  await append(store, [user]);
  const before = await store.snapshot();
  const root = await readCommittedIndex(store, before.root, "messages");
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(store, root, user.messageUid),
  );
  const update = {
    messageUid: user.messageUid,
    dialogProcessId: user.dialogProcessId,
    turnScopeId: user.turnScopeId,
    expectedContentReference: stored.parts.find(({ path }) => path[1] === "content").reference,
    owner: stored.value.ordinal,
    metadata: {},
    metadataRemovals: [],
  };
  for (const [index, changes] of [
    { messages: [{ ...user, attachments: [] }] },
    { messages: [{ ...user, attachments: [{ ...attachment, name: "replacement.txt" }] }] },
    { messageMetadataUpdates: [{ ...update, metadata: { attachments: [] } }] },
    { messageMetadataUpdates: [{ ...update, metadataRemovals: ["attachments"] }] },
  ].entries()) {
    await assert.rejects(
      commitSessionChanges({
        sessionDir: store.sessionDir,
        sessionId: store.sessionId,
        expectedGeneration: before.generation,
        operationId: `forbidden-attachment-${index}`,
        committedAt: timestamp,
        changes,
      }),
      { code: "SESSION_COMMIT_INPUT_INVALID", message: /require the binding command/ },
    );
    assert.equal((await store.snapshot()).generation, before.generation);
  }
  await append(store, [{ ...user, content: "changed" }], "same-attachments");
  assert.equal((await store.snapshot()).generation, before.generation + 1);
});

test("content fragments commit with exact versions, shared indexes and idempotent receipts", async (t) => {
  const store = await fixture(t);
  const content = "prefix ".repeat(100000);
  await append(store, [message("fragment", { content })]);
  const before = await store.snapshot();
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, before.root, "messages"),
      "fragment",
    ),
  );
  const request = {
    messageUid: "fragment",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    expectedContentReference: stored.parts[0].reference,
    owner: stored.value.ordinal,
    content: '🙂"\\\n',
  };
  const options = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "content-fragment",
    committedAt: timestamp,
    changes: { messageContentAppends: [request], messages: [message("other")] },
  };
  const encode = t.mock.method(ImmutableSessionStore.prototype, "putCollectionValue");
  const result = await commitSessionChanges(options);
  assert.deepEqual(
    encode.mock.calls
      .filter(({ arguments: [collection] }) => collection === "messages")
      .map(({ arguments: [, key] }) => key),
    ["other", "fragment"],
  );
  assert.equal(result.result.messageReceipts.length, 2);
  const after = await store.snapshot();
  const record = await store.get(after, "messages", "fragment");
  assert.equal(record.message.content, content + request.content);
  assert.equal(record.ordinal, 1);
  const turn = await store.get(after, "turns", "turn-1");
  assert.equal(
    (
      await readCommittedValue(
        store,
        await readCommittedIndex(store, turn.messagesRoot, "fragment"),
      )
    ).message.content,
    content + request.content,
  );
  assert.deepEqual(
    (await commitSessionChanges(options)).result.messageReceipts,
    result.result.messageReceipts,
  );
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "stale-content",
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  assert.equal((await store.snapshot()).generation, after.generation);
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "wrong-owner",
      changes: { messageContentAppends: [{ ...request, dialogProcessId: "other" }] },
    }),
    { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" },
  );
});

test("metadata deltas reuse content without any body reads and replay their exact receipt", async (t) => {
  const store = await fixture(t);
  const content = randomBytes(400000).toString("base64");
  await append(store, [message("metadata", { content })]);
  const before = await store.snapshot();
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, before.root, "messages"),
      "metadata",
    ),
  );
  const request = {
    messageUid: "metadata",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    expectedContentReference: stored.parts[0].reference,
    owner: stored.value.ordinal,
    metadata: { summarized: true },
    metadataRemovals: [],
  };
  const options = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "metadata-delta",
    committedAt: timestamp,
    changes: { messageMetadataUpdates: [request] },
  };
  const forbidden = await collectValueRecords(store, stored.parts[0].reference);
  setFsAdapter(await forbidRecordReads(store, forbidden));
  let outcome;
  try {
    outcome = await commitSessionChanges(options);
    assert.equal(
      outcome.result.messageReceipts[0].contentReference,
      request.expectedContentReference,
    );
    assert.deepEqual(await commitSessionChanges(options), { ...outcome, replayed: true });
  } finally {
    resetFsAdapter();
  }
  const after = await store.snapshot();
  const record = await store.get(after, "messages", "metadata");
  assert.equal(record.message.content, content);
  assert.equal(record.message.summarized, true);
  const turn = await store.get(after, "turns", "turn-1");
  assert.deepEqual(
    await readCommittedValue(store, await readCommittedIndex(store, turn.messagesRoot, "metadata")),
    record,
  );
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "metadata-wrong-owner",
      changes: { messageMetadataUpdates: [{ ...request, turnScopeId: "other" }] },
    }),
    { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" },
  );
});

test("presentation metadata demotion preserves body versions and both snapshot indexes without body IO", async (t) => {
  const store = await fixture(t);
  const source = message("presentation-metadata", {
    role: "assistant",
    userMessageId: undefined,
    messageOrigin: undefined,
    modelMessageId: "model-presentation-metadata",
    presentationMessageId: "presentation-1",
    chatPresentation: true,
    workspaceRootDirectory: "/workspace",
    content: randomBytes(400000).toString("base64"),
  });
  await append(store, [source]);
  const before = await store.snapshot();
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, before.root, "messages"),
      source.messageUid,
    ),
  );
  const request = {
    messageUid: source.messageUid,
    dialogProcessId: source.dialogProcessId,
    turnScopeId: source.turnScopeId,
    expectedContentReference: stored.parts[0].reference,
    owner: stored.value.ordinal,
    metadata: { chatPresentation: false },
    metadataRemovals: ["workspaceRootDirectory"],
  };
  const options = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "presentation-metadata-demotion",
    committedAt: timestamp,
    changes: { messageMetadataUpdates: [request] },
  };
  const forbidden = await collectValueRecords(store, request.expectedContentReference);
  const prototype = store.objects.constructor.prototype;
  const put = prototype.put;
  const writeGuard = t.mock.method(prototype, "put", function (bytes) {
    const identity = createHash("sha256").update(bytes).digest("hex");
    assert.equal(forbidden.has(identity), false, `Unexpected body write preparation: ${identity}`);
    return put.call(this, bytes);
  });
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    const observed = await observeSessionStorageWork(() => commitSessionChanges(options));
    assert.ok(observed.work.immutableWriteBytes < 32768, JSON.stringify(observed.work));
    assert.equal(
      observed.result.result.messageReceipts[0].contentReference,
      request.expectedContentReference,
    );
    assert.deepEqual(await commitSessionChanges(options), { ...observed.result, replayed: true });
  } finally {
    resetFsAdapter();
    writeGuard.mock.restore();
  }
  const after = await store.snapshot();
  const record = await store.get(after, "messages", source.messageUid);
  assert.equal(record.message.content, source.content);
  assert.equal(record.message.chatPresentation, false);
  assert.equal(Object.hasOwn(record.message, "workspaceRootDirectory"), false);
  const turn = await store.get(after, "turns", source.turnScopeId);
  assert.equal(turn.canonicalAssistantUid, "");
  assert.deepEqual(
    await readCommittedValue(
      store,
      await readCommittedIndex(store, turn.messagesRoot, source.messageUid),
    ),
    record,
  );
  const previousTurn = await store.get(before, "turns", source.turnScopeId);
  assert.equal(previousTurn.canonicalAssistantUid, source.messageUid);
  assert.deepEqual((await store.get(before, "messages", source.messageUid)).message, source);
  assert.deepEqual(
    (
      await readCommittedValue(
        store,
        await readCommittedIndex(store, previousTurn.messagesRoot, source.messageUid),
      )
    ).message,
    source,
  );
});

test("unchanged message confirmations reuse the body and preserve versioned receipts", async (t) => {
  const store = await fixture(t);
  const source = message("confirmation", { content: randomBytes(400000).toString("base64") });
  const ownership = {
    sessionId: store.sessionId,
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
  };
  const seed = await commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "confirmation-seed",
    committedAt: timestamp,
    changes: { messages: [source] },
  });
  const receipt = seed.result.messageReceipts[0];
  const before = await store.snapshot();
  const changes = projectMessagePersistenceChange(source, { message: source, receipt }, ownership);
  assert.equal(changes.messages, undefined);
  const request = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "confirmation",
    committedAt: timestamp,
    changes,
  };
  const forbidden = await collectValueRecords(store, receipt.contentReference);
  const prototype = store.objects.constructor.prototype;
  const put = prototype.put;
  const writeGuard = t.mock.method(prototype, "put", function (bytes) {
    const identity = createHash("sha256").update(bytes).digest("hex");
    assert.equal(forbidden.has(identity), false, `Unexpected body write preparation: ${identity}`);
    return put.call(this, bytes);
  });
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    const observed = await observeSessionStorageWork(() => commitSessionChanges(request));
    const outcome = observed.result;
    assert.ok(observed.work.immutableWriteBytes < 32768, JSON.stringify(observed.work));
    assert.deepEqual(outcome.result.messageReceipts, [
      { ...receipt, generation: outcome.generation },
    ]);
    const replay = await observeSessionStorageWork(() => commitSessionChanges(request));
    assert.deepEqual(replay.result, { ...outcome, replayed: true });
    assert.equal(replay.work.immutableWriteBytes ?? 0, 0);
    await assert.rejects(
      commitSessionChanges({
        ...request,
        expectedGeneration: outcome.generation,
        operationId: "confirmation-foreign",
        changes: {
          messageMetadataUpdates: [
            { ...changes.messageMetadataUpdates[0], turnScopeId: "foreign" },
          ],
        },
      }),
      { code: "SESSION_MESSAGE_IDENTITY_CONFLICT" },
    );
    assert.equal((await store.snapshot()).generation, outcome.generation);
  } finally {
    resetFsAdapter();
    writeGuard.mock.restore();
  }
  const after = await store.snapshot();
  assert.deepEqual((await store.get(after, "messages", source.messageUid)).message, source);
  await append(store, [{ ...source, content: "replacement" }], "confirmation-replace");
  const replaced = await store.snapshot();
  await assert.rejects(
    commitSessionChanges({
      ...request,
      expectedGeneration: replaced.generation,
      operationId: "confirmation-stale",
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  assert.equal((await store.snapshot()).generation, replaced.generation);
  assert.deepEqual((await commitSessionChanges(request)).result.messageReceipts, [
    { ...receipt, generation: after.generation },
  ]);
});

test("content and metadata deltas share one version check, one publication and one receipt", async (t) => {
  const store = await fixture(t);
  await append(store, [message("combined", { content: "prefix" })]);
  const before = await store.snapshot();
  const stored = await readCommittedValueMetadata(
    store,
    await readCommittedIndex(
      store,
      await readCommittedIndex(store, before.root, "messages"),
      "combined",
    ),
  );
  const identity = {
    messageUid: "combined",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    expectedContentReference: stored.parts[0].reference,
    owner: stored.value.ordinal,
  };
  const options = {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: before.generation,
    operationId: "combined-delta",
    committedAt: timestamp,
    changes: {
      messageContentAppends: [{ ...identity, content: " tail" }],
      messageMetadataUpdates: [
        { ...identity, metadata: { summarized: true }, metadataRemovals: [] },
      ],
    },
  };
  const outcome = await commitSessionChanges(options);
  assert.equal(outcome.result.messageReceipts.length, 1);
  assert.notEqual(
    outcome.result.messageReceipts[0].contentReference,
    identity.expectedContentReference,
  );
  const after = await store.snapshot();
  const record = await store.get(after, "messages", "combined");
  assert.equal(record.message.content, "prefix tail");
  assert.equal(record.message.summarized, true);
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "combined-stale",
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  await assert.rejects(
    commitSessionChanges({
      ...options,
      expectedGeneration: after.generation,
      operationId: "metadata-stale",
      changes: { messageMetadataUpdates: options.changes.messageMetadataUpdates },
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  assert.equal((await store.snapshot()).generation, after.generation);
});

test("content append preserves the display timeline without reading its stored payload", async (t) => {
  const store = await fixture(t);
  const item = (id) => ({ key: `call:${id}`, toolCallId: id, tool: "read", status: "running" });
  await append(store, [
    message("timeline", {
      content: "prefix",
      toolTimeline: [{ ...item("old"), args: { text: randomBytes(65536).toString("hex") } }],
    }),
  ]);
  const stored = async (snapshot) =>
    readCommittedValueMetadata(
      store,
      await readCommittedIndex(
        store,
        await readCommittedIndex(store, snapshot.root, "messages"),
        "timeline",
      ),
    );
  const before = await store.snapshot();
  const { value, parts } = await stored(before);
  const timeline = parts.find(({ path }) => path[1] === "toolTimeline");
  assert.ok(timeline, "fixture must store the timeline separately");
  const identity = {
    messageUid: "timeline",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    owner: value.ordinal,
  };
  const commit = (expectedGeneration, operationId, changes) =>
    commitSessionChanges({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      expectedGeneration,
      operationId,
      committedAt: timestamp,
      changes,
    });
  setFsAdapter(
    await forbidRecordReads(store, await collectValueRecords(store, timeline.reference)),
  );
  let outcome;
  try {
    outcome = await commit(before.generation, "timeline-content", {
      messageContentAppends: [
        {
          ...identity,
          expectedContentReference: parts.find(({ path }) => path[1] === "content").reference,
          content: " tail",
        },
      ],
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual((await stored(await store.snapshot())).value.display, value.display);
  const [{ contentReference }] = outcome.result.messageReceipts;
  for (const [metadata, metadataRemovals, expected] of [
    [{ toolTimeline: [item("new")] }, [], [item("new")]],
    [{}, ["toolTimeline"], []],
  ]) {
    const snapshot = await store.snapshot();
    await commit(snapshot.generation, `timeline-metadata-${snapshot.generation}`, {
      messageMetadataUpdates: [
        { ...identity, expectedContentReference: contentReference, metadata, metadataRemovals },
      ],
    });
    assert.deepEqual((await stored(await store.snapshot())).value.display.toolTimeline, expected);
  }
});

for (const [prefix, title] of [
  ["   ", "new title"],
  [" ".repeat(SESSION_AUTO_TITLE_MAX_LENGTH), ""],
])
  test(`content append derives titles from the stored prefix (${prefix.length} spaces)`, async (t) => {
    const store = await fixture(t);
    await append(store, [message("blank", { content: prefix })]);
    const before = await store.snapshot();
    const stored = await readCommittedValueMetadata(
      store,
      await readCommittedIndex(
        store,
        await readCommittedIndex(store, before.root, "messages"),
        "blank",
      ),
    );
    const committedAt = "2026-01-02T00:00:00.000Z";
    await commitSessionChanges({
      sessionDir: store.sessionDir,
      sessionId: store.sessionId,
      expectedGeneration: before.generation,
      operationId: "title-fragment",
      committedAt,
      changes: {
        messageContentAppends: [
          {
            messageUid: "blank",
            dialogProcessId: "dialog-1",
            turnScopeId: "turn-1",
            expectedContentReference: stored.parts[0].reference,
            owner: stored.value.ordinal,
            content: "new title",
          },
        ],
      },
    });
    const head = await store.snapshot();
    assert.equal(
      (await store.get(head, "messages", "blank")).message.content,
      `${prefix}new title`,
    );
    const metadata = await store.get(head, "metadata", "session");
    assert.equal(Object.hasOwn(metadata, "autoTitle"), false);
    assert.equal(metadata.updatedAt, committedAt);
    assert.equal(await readImmutableSessionAutoTitle(store, before), "");
    const reopened = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
    assert.equal(await readImmutableSessionAutoTitle(reopened, await reopened.snapshot()), title);
  });

registerImmutableMessageBodyStorageTests({ fixture, message, append, timestamp });
