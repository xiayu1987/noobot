/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import { messageReadJsonBytes } from "@noobot/session-protocol/message-read-budget";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import {
  readRetainedSessionDetailStart,
  readRetainedSessionDisplayPage,
  releaseRetainedSessionDisplayPage,
} from "../../src/session/session-display-page.js";
import { SessionPageSnapshots } from "../../src/session/session-page-snapshots.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { buildSessionDisplayProjection } from "../../src/session/session-summary-builders/session-display-summary.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { observeStorageIo } from "../helpers/storage-io-observation.js";
import { canonicalActivity } from "./session-repository-boundary.summaries.fixtures.js";
import {
  committedAt,
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

test("retained display continuation reads the original partition and releases its reader", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { pageRecords: 1 });
  const messages = openTestMessages(journal, sessionId);
  for (const uid of ["older", "newer"])
    await messages.commit(
      await prepare(journal, messages, uid, { messages: [message(sessionId, uid)] }),
    );
  await using snapshots = new SessionPageSnapshots();
  const pageSnapshots = snapshots.withReadAuthority(async () => {});
  const identity = ["owner", sessionId];
  let opens = 0;
  const open = () => {
    opens += 1;
    return openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  };
  const request = { sessionId, cursor: null, direction: "backward", limit: 1, maxBytes: 4096 };
  const read = (cursor, owner = identity) =>
    readRetainedSessionDisplayPage({
      pageSnapshots,
      identity: owner,
      open,
      request: { ...request, cursor },
    });
  const release = (cursor) =>
    releaseRetainedSessionDisplayPage({
      pageSnapshots,
      identity,
      request: { sessionId, cursor },
    });
  const first = await read(null);
  assert.deepEqual(
    first.messages.map(({ messageUid }) => messageUid),
    ["newer"],
  );
  assert.equal(first.stats.displayMessageCount, 2);
  await assert.rejects(read(first.nextCursor, ["other", sessionId]), {
    code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
  });
  await messages.commit(
    await prepare(journal, messages, "latest", { messages: [message(sessionId, "latest")] }),
  );
  const last = await read(first.nextCursor);
  assert.equal(last.generation, first.generation);
  assert.deepEqual(last.stats, first.stats);
  assert.deepEqual(
    last.messages.map(({ messageUid }) => messageUid),
    ["older"],
  );
  assert.equal(last.nextCursor, null);
  assert.equal(opens, 1);
  assert.deepEqual(await release(first.nextCursor), { released: false });
  const fresh = await read(null);
  assert.equal(fresh.stats.displayMessageCount, 3);
  assert.deepEqual(await release(fresh.nextCursor), { released: true });
  await assert.rejects(read(fresh.nextCursor), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
});

test("detail start and continuation share a reader and the start charges its complete UTF-8 payload", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, { pageRecords: 1 });
  const messages = openTestMessages(journal, sessionId);
  for (const uid of ["older", "newer"])
    await messages.commit(
      await prepare(journal, messages, uid, {
        messages: [{ ...message(sessionId, uid), content: "\u{1F642}" }],
      }),
    );
  await using snapshots = new SessionPageSnapshots();
  const pageSnapshots = snapshots.withReadAuthority(async () => {});
  const readers = [];
  const open = async () => {
    const reader = await openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
    readers.push(reader);
    const { readDisplayPage, readLifecycleSource, readMetadata, generation, close } = reader;
    return { readDisplayPage, readLifecycleSource, readMetadata, generation, close };
  };
  const request = { sessionId, cursor: null, direction: "backward", limit: 1, maxBytes: 4096 };
  const access = { pageSnapshots, identity: ["owner", sessionId], open };
  const start = (maxBytes) =>
    readRetainedSessionDetailStart({
      ...access,
      request: { ...request, maxBytes, terminalLimit: 0, reconcileTurnScopeIds: [] },
    });
  const first = await start(request.maxBytes);
  assert.deepEqual(
    first.messages.map(({ messageUid }) => messageUid),
    ["newer"],
  );
  assert.equal(first.stats.displayMessageCount, 2);
  assert.equal(first.turnLifecycleSnapshot.sessionId, sessionId);
  assert.deepEqual(first.turnLifecycleSnapshot.recentTerminalTurns, []);
  assert.equal(Object.hasOwn(first, "executionLogs"), false);
  assert.equal(Object.hasOwn(first, "sessionArtifactEvents"), false);
  const exactBytes = messageReadJsonBytes(first);
  await assert.rejects(start(exactBytes - 1), { code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED" });
  await assert.rejects(readers[1].readMetadata(), { code: "SESSION_READER_CLOSED" });
  const exact = await start(exactBytes);
  assert.equal(messageReadJsonBytes(exact), exactBytes);
  await releaseRetainedSessionDisplayPage({
    pageSnapshots,
    identity: access.identity,
    request: { sessionId, cursor: exact.nextCursor },
  });
  await messages.commit(
    await prepare(journal, messages, "latest", { messages: [message(sessionId, "latest")] }),
  );
  const next = await readRetainedSessionDisplayPage({
    ...access,
    request: { ...request, cursor: first.nextCursor },
  });
  assert.equal(next.generation, first.generation);
  assert.deepEqual(next.stats, first.stats);
  assert.deepEqual(
    next.messages.map(({ messageUid }) => messageUid),
    ["older"],
  );
  assert.equal(next.nextCursor, null);
  assert.equal(readers.length, 3);
  await assert.rejects(readers[0].readMetadata(), { code: "SESSION_READER_CLOSED" });
});

test("partition display projection matches business rules across pages, pinned snapshots and cold reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { pageRecords: 1 });
  const messages = openTestMessages(journal, sessionId);
  const options = { journal, sessionId, parentSessionId: "" };
  const selection = { cursor: null, direction: "forward", limit: 1, maxBytes: 4096 };
  await messages.commit(
    await prepare(journal, messages, "seed-display", {
      messages: [message(sessionId, "visible")],
    }),
  );
  await messages.commit(
    await prepare(journal, messages, "hidden-display", {
      messages: [{ ...message(sessionId, "hidden"), chatPresentation: false }],
    }),
  );
  const appendTool = await prepare(journal, messages, "display-tool", {
    messages: [
      {
        ...message(sessionId, "call"),
        type: "tool_call",
        tool_calls: [
          { id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } },
        ],
      },
    ],
  });
  const appended = await messages.commit(appendTool);
  assert.equal((await messages.commit(appendTool)).generation, appended.generation);
  let before;
  let escaped;
  {
    await using reader = await openPartitionSessionReader(options);
    escaped = reader;
    before = await reader.readDisplayProjection();
    const expected = buildSessionDisplayProjection(await reader.exportSession());
    for (const entry of expected.messages) entry.sessionOrdinal = 1;
    assert.deepEqual(before, expected);
    const page = await reader.readDisplayPage(selection);
    const [{ contentReference, contentBytes, ...facts }] = page.messages;
    const [{ content, ...expectedFacts }] = expected.messages;
    assert.ok(contentReference);
    assert.equal(contentBytes, messageReadJsonBytes(content));
    assert.deepEqual(facts, expectedFacts);
    assert.deepEqual(page.stats, expected.stats);
    const counts = { messageCount: 3, injectedMessageCount: 0, toolLogCount: 1 };
    assert.deepEqual(await reader.readDisplaySourceCounts(), counts);
    assert.equal(before.stats.toolLogCount, 1);
    assert.deepEqual(
      before.messages.map(({ messageUid }) => messageUid),
      ["visible"],
    );
    await messages.commit(
      await prepare(journal, messages, "delete-display", {
        messageDeletion: {
          commandId: "delete-display",
          anchor: { turnScopeId: scope.turnScopeId },
        },
      }),
    );
    await messages.commit(
      await prepare(journal, messages, "reuse-display-position", {
        messages: [
          {
            ...message(sessionId, "replacement"),
            dialogProcessId: "replacement-dialog",
            turnScopeId: "replacement-turn",
          },
        ],
      }),
    );
    assert.deepEqual(await reader.readDisplayProjection(), before);
    assert.deepEqual(await reader.readDisplayPage(selection), page);
    assert.deepEqual(await reader.readDisplaySourceCounts(), counts);
  }
  await assert.rejects(escaped.readDisplayProjection(), { code: "SESSION_READER_CLOSED" });
  await assert.rejects(escaped.readDisplayPage(selection), { code: "SESSION_READER_CLOSED" });
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  await using current = await openPartitionSessionReader({ ...options, journal: cold });
  const after = await current.readDisplayPage(selection);
  assert.deepEqual(
    after.messages.map(({ messageUid, sessionOrdinal }) => [messageUid, sessionOrdinal]),
    [["replacement", 1]],
  );
  assert.equal(after.stats.messageCount, 1);
  assert.equal(after.stats.displayMessageCount, 1);
  assert.deepEqual(await current.readDisplaySourceCounts(), {
    messageCount: 1,
    injectedMessageCount: 0,
    toolLogCount: 0,
  });
});

test("display pages expose each retained content version without reading body chunks", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const selection = { cursor: null, direction: "forward", limit: 1, maxBytes: 4096 };
  const options = { journal, sessionId, parentSessionId: "" };
  const initial = message(sessionId, "visible");
  const suffix = ' "\\\n\u{1F642}'.repeat(48);
  const created = await messages.commit(
    await prepare(journal, messages, "seed-body", { messages: [initial] }),
  );
  const { owner, contentReference } = created.result.messageReceipts[0];
  let appendedPage;
  {
    await using retained = await openPartitionSessionReader(options);
    const appended = await messages.commit(
      await prepare(journal, messages, "append-body", {
        messageContentAppends: [
          {
            ...scope,
            messageUid: initial.messageUid,
            owner,
            expectedContentReference: contentReference,
            content: suffix,
          },
        ],
      }),
    );
    const retainedPage = await retained.readDisplayPage(selection);
    assert.equal(retainedPage.messages[0].contentReference, contentReference);
    assert.equal(retainedPage.messages[0].contentBytes, messageReadJsonBytes(initial.content));
    await using current = await openPartitionSessionReader(options);
    appendedPage = await current.readDisplayPage(selection);
    assert.equal(
      appendedPage.messages[0].contentReference,
      appended.result.messageReceipts[0].contentReference,
    );
    assert.equal(
      appendedPage.messages[0].contentBytes,
      messageReadJsonBytes(initial.content + suffix),
    );
    assert.equal(Object.hasOwn(appendedPage.messages[0], "content"), false);
    assert.deepEqual(appendedPage.stats, retainedPage.stats);
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const readSlots = cold.readRecordSlots.bind(cold);
  let contentRecords = 0;
  cold.readRecordSlots = async (query) => {
    const slots = await readSlots(query);
    for (const { mutation } of slots.values())
      if (mutation.collection === PARTITION_MESSAGE_COLLECTIONS.content) contentRecords += 1;
    return slots;
  };
  await using reader = await openPartitionSessionReader({ ...options, journal: cold });
  const exactBytes = messageReadJsonBytes(appendedPage);
  await assert.rejects(reader.readDisplayPage({ ...selection, maxBytes: exactBytes - 1 }), {
    code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
  });
  assert.equal(contentRecords, 0);
  assert.deepEqual(
    await reader.readDisplayPage({ ...selection, maxBytes: exactBytes }),
    appendedPage,
  );
  assert.equal(contentRecords, 0);
});

test("a retained display presentation owner rejects reuse by another turn after cold reopen", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const first = message(sessionId, "first");
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(await prepare(journal, messages, "first", { messages: [first] }));
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const reopened = openTestMessages(cold, sessionId);
  const before = cold.head.sequence;
  const request = await prepare(cold, reopened, "conflict", {
    messages: [
      {
        ...message(sessionId, "second"),
        turnScopeId: "turn-2",
        dialogProcessId: "dialog-2",
        presentationMessageId: first.presentationMessageId,
      },
    ],
  });
  await assert.rejects(reopened.commit(request), {
    code: "SESSION_TURN_IDENTITY_CONFLICT",
    message: "Display presentation belongs to multiple turns",
  });
  assert.equal(cold.head.sequence, before);
  await using reader = await openPartitionSessionReader({
    journal: cold,
    sessionId,
    parentSessionId: "",
  });
  const page = await reader.readDisplayPage({
    cursor: null,
    direction: "forward",
    limit: 2,
    maxBytes: 4096,
  });
  assert.deepEqual(
    page.messages.map(({ messageUid }) => messageUid),
    [first.messageUid],
  );
});

test("thinking membership changes display statistics without rewriting ranked rows", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const open = (journal) => openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  const commit = async (id, changes) =>
    repository.commit(await prepare(journal, repository, id, changes));
  const page = (reader) =>
    reader.readDisplayPage({ cursor: null, direction: "forward", limit: 4, maxBytes: 8192 });
  const source = { ...message(sessionId, "thinking"), chatPresentation: true };
  const { result } = await commit("seed-thinking", {
    messages: [source, message(sessionId, "second")],
  });
  const { owner, contentReference } = result.messageReceipts.find(
    ({ messageUid }) => messageUid === source.messageUid,
  );
  const update = async (id, activityTimeline) => {
    const { reference } = await commit(id, {
      messageMetadataUpdates: [
        {
          ...scope,
          messageUid: source.messageUid,
          owner,
          expectedContentReference: contentReference,
          metadata: { activityTimeline },
          metadataRemovals: [],
        },
      ],
    });
    const { request } = await journal.usingSnapshot((snapshot) =>
      journal.readRecord({ snapshot, reference }),
    );
    assert.ok(request.payload.mutations.some(({ key }) => key.startsWith("display:deps:")));
    assert.ok(request.payload.mutations.every(({ key }) => !/^display:(row|order):/.test(key)));
  };
  {
    await using before = await open(journal);
    const initial = await page(before);
    assert.equal(initial.stats.displayMessageCount, 2);
    assert.equal(initial.stats.thinkingMessageCount, 0);
    await update("first-thinking", [
      canonicalActivity({
        ...scope,
        sessionId,
        sequenceScopeId: source.modelMessageId,
        presentationMessageId: source.presentationMessageId,
      }),
    ]);
    await using withThinking = await open(journal);
    const marked = await page(withThinking);
    assert.equal(marked.stats.thinkingMessageCount, 2);
    assert.ok(marked.messages.every((row) => row.hasThinkingDetails === true));
    await update("last-thinking", []);
    assert.deepEqual(await page(before), initial);
    assert.deepEqual(await page(withThinking), marked);
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  await using reopened = await open(cold);
  const final = await page(reopened);
  assert.equal(final.stats.thinkingMessageCount, 0);
  assert.ok(final.messages.every((row) => !Object.hasOwn(row, "hasThinkingDetails")));
});

test("a checkpoint updates the display's message facts only in the new snapshot", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const options = { journal, sessionId, parentSessionId: "" };
  const selection = { cursor: null, direction: "forward", limit: 1, maxBytes: 4096 };
  const source = message(sessionId, "visible");
  await messages.commit(await prepare(journal, messages, "seed", { messages: [source] }));
  const request = await prepare(journal, messages, "checkpoint", {
    summaryCheckpoints: [
      {
        ...scope,
        sessionId,
        userId: "admin",
        checkpointId: "summary",
        expectedCheckpointRevision: 0,
        messages: [],
        persistedMessageUids: [],
        summarizedMessageUids: [source.messageUid],
        retainedMessageUids: [],
      },
    ],
  });
  let latest;
  let committed;
  {
    await using retained = await openPartitionSessionReader(options);
    const before = await retained.readDisplayPage(selection);
    assert.equal(before.messages[0].summarized, false);
    committed = await messages.commit(request);
    const { request: durable } = await journal.usingSnapshot((snapshot) =>
      journal.readRecord({ snapshot, reference: committed.reference }),
    );
    assert.deepEqual(
      durable.payload.mutations.filter(
        ({ collection, key }) => collection === "metadata" && key.startsWith("display:"),
      ),
      [],
    );
    assert.deepEqual(await retained.readDisplayPage(selection), before);
    await using current = await openPartitionSessionReader(options);
    latest = await current.readDisplayPage(selection);
    assert.deepEqual(latest.messages, [{ ...before.messages[0], summarized: true }]);
    assert.deepEqual(latest.stats, before.stats);
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const replay = await openTestMessages(cold, sessionId).commit(request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.generation, committed.generation);
  await using reopened = await openPartitionSessionReader({ ...options, journal: cold });
  const page = await reopened.readDisplayPage(selection);
  assert.deepEqual(page.messages, latest.messages);
  assert.deepEqual(page.stats, latest.stats);
});

for (const published of [false, true]) {
  test(`display rows and source counts recover atomically after a fault ${published ? "after" : "before"} CURRENT rename`, async (t) => {
    const { journal, sessionId, root } = await createMessageCase(t, {}, { autoClose: false });
    const messages = openTestMessages(journal, sessionId);
    const request = await prepare(journal, messages, "injected-display", {
      messages: [
        message(sessionId, "visible"),
        {
          ...message(sessionId, "injected"),
          injectedMessage: true,
          injectedMessageType: "guidance",
          chatPresentation: false,
        },
      ],
    });
    const adapter = getFsAdapter();
    setFsAdapter({
      ...adapter,
      async rename(source, target) {
        if (String(target) !== join(root, "CURRENT")) return adapter.rename(source, target);
        if (published) await adapter.rename(source, target);
        throw Object.assign(new Error("display publication fault"), { code: "EIO" });
      },
    });
    try {
      await assert.rejects(messages.commit(request), (error) => {
        assert.equal(error.code, "SESSION_COMMIT_UNCERTAIN");
        assert.equal(error.cause.code, "EIO");
        assert.equal(error.cause.message, "display publication fault");
        return true;
      });
    } finally {
      setFsAdapter(adapter);
    }
    await assert.rejects(journal.close(), { code: "SESSION_COMMIT_UNCERTAIN" });
    const cold = await PartitionJournal.open({ root, sessionId });
    t.after(() => cold.close());
    const options = { journal: cold, sessionId, parentSessionId: "" };
    const expectCommitted = async (reader, committed) => {
      const count = Number(committed);
      const page = await reader.readDisplayPage({
        cursor: null,
        direction: "forward",
        limit: 1,
        maxBytes: 4096,
      });
      assert.deepEqual(
        page.messages.map(({ messageUid }) => messageUid),
        committed ? ["visible"] : [],
      );
      assert.equal(page.stats.messageCount, 2 * count);
      assert.equal(page.stats.displayMessageCount, count);
      assert.deepEqual(await reader.readDisplaySourceCounts(), {
        messageCount: 2 * count,
        injectedMessageCount: count,
        toolLogCount: 0,
      });
      assert.deepEqual(
        (await reader.exportSession()).messages.map(({ messageUid }) => messageUid),
        committed ? ["visible", "injected"] : [],
      );
    };
    await using retained = await openPartitionSessionReader(options);
    await expectCommitted(retained, published);
    const recovered = openTestMessages(cold, sessionId);
    assert.equal((await recovered.commit(request)).replayed, published);
    assert.equal((await recovered.commit(request)).replayed, true);
    await using current = await openPartitionSessionReader(options);
    await expectCommitted(current, true);
    await expectCommitted(retained, published);
  });
}

test("partition display consumes selective pages and excludes large suppressed bodies", async (t) => {
  const { journal, sessionId } = await createMessageCase(t, {
    transactionBytes: 32 * 1024,
    receiptBytes: 32 * 1024,
    pageBytes: 32 * 1024,
  });
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "large-hidden", {
      messages: [
        message(sessionId, "visible"),
        { ...message(sessionId, "hidden"), chatPresentation: false, content: "x".repeat(20000) },
      ],
    }),
  );
  await using reader = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  await assert.rejects(reader.readMessagePage({ maxBytes: 4096 }), {
    code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
  });
  const page = await reader.readDisplaySourcePage({ maxBytes: 4096 });
  assert.equal(page.records[1].message.content, null);
  const projection = await reader.readDisplayProjection();
  assert.deepEqual(
    projection.messages.map(({ messageUid }) => messageUid),
    ["visible"],
  );
  assert.equal(projection.messages[0].sessionOrdinal, 1);
});

test("partition display derives pending presentations and plugin artifacts from the pinned authority", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 16 * 1024 });
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "accept", {
      messages: [
        {
          ...scope,
          sessionId,
          messageUid: "user",
          role: "user",
          messageOrigin: "natural",
          type: "message",
          content: "question",
          attachments: [],
          ts: committedAt,
          pending: true,
          turnCommit: { action: "send", commandId: "accept" },
        },
      ],
      turnTransition: {
        ...scope,
        sessionId,
        commandId: "accept",
        causationId: "accept",
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        presentationMessageId: "answer",
        executionId: "agent:turn-1",
        executionKind: "agent",
        rootExecutionId: "agent:turn-1",
      },
      timings: [{ ...scope, thinkingFinishedAt: committedAt }],
    }),
  );
  const metadata = await journal.usingSnapshot((snapshot) => messages.readMetadata({ snapshot }));
  const envelope = createPluginArtifactEnvelope({
    pluginId: "display",
    artifactType: "result",
    artifactId: "artifact",
    sessionId,
    turnScopeId: scope.turnScopeId,
    sequence: 1,
    revision: 1,
    operation: "created",
    baseRevision: null,
    data: { title: "result" },
    occurredAt: committedAt,
  });
  await messages.commit(
    await prepare(journal, messages, "artifact", {
      artifactEvents: [
        {
          eventId: envelope.identity.eventId,
          envelope: {
            ...envelope,
            ordering: { ...envelope.ordering, aggregateVersion: metadata.aggregateVersion + 1 },
          },
          committedAt,
          deliveries: {},
        },
      ],
    }),
  );
  let before;
  let expectedEventIds;
  {
    await using reader = await openPartitionSessionReader({
      journal,
      sessionId,
      parentSessionId: "",
    });
    before = await reader.readDisplayProjection();
    const expected = buildSessionDisplayProjection(await reader.exportSession());
    expected.messages[0].sessionOrdinal = 1;
    assert.deepEqual(before, expected);
    assert.equal(before.messages[1].turnPlaceholder, true);
    assert.equal(Object.hasOwn(before.messages[1], "sessionOrdinal"), false);
    assert.equal(before.messages[1].presentationMessageId, "answer");
    assert.equal(before.sessionArtifactEvents.length, 1);
    assert.deepEqual(before.turnTimings, [{ ...scope, thinkingFinishedAt: committedAt }]);
    for (const direction of ["forward", "backward"]) {
      const readPage = (cursor) =>
        reader.readDisplayPage({ cursor, direction, limit: 1, maxBytes: 4096 });
      const first = await readPage(null);
      assert.notEqual(first.nextCursor, null);
      const second = await readPage(first.nextCursor);
      assert.equal(first.generation, reader.generation);
      assert.equal(second.generation, reader.generation);
      const [head, tail] = direction === "forward" ? [first, second] : [second, first];
      const [published, placeholder] = [...head.messages, ...tail.messages];
      const { contentReference, contentBytes, ...facts } = published;
      const [{ content, ...expectedFacts }, expectedPlaceholder] = expected.messages;
      assert.ok(contentReference);
      assert.equal(contentBytes, messageReadJsonBytes(content));
      assert.deepEqual(facts, expectedFacts);
      assert.deepEqual(placeholder, expectedPlaceholder);
      assert.deepEqual(first.stats, expected.stats);
      assert.deepEqual(second.stats, expected.stats);
      assert.equal(second.nextCursor, null);
    }
    const consumerId = "runtime-events";
    const pending = await reader.readOutboxPage({ consumerId });
    expectedEventIds = pending.events.map(({ eventId }) => eventId);
    assert.deepEqual(pending.events.at(-1).eventId, envelope.identity.eventId);
    assert.equal(pending.hasMore, false);
    await messages.commit(
      await prepare(journal, messages, "deliver-display-events", {
        deliveries: pending.events.map(({ eventId, envelope: { ordering } }) => ({
          type: "acknowledge",
          eventId,
          consumerId,
          deliveredAt: committedAt,
          orderingDomain: ordering.domain,
          orderingScopeId: ordering.scopeId,
          sequence: ordering.sequence,
        })),
        outboxCursors: [{ consumerId, expectedCursor: pending.after, cursor: pending.cursor }],
      }),
    );
    assert.deepEqual(await reader.readOutboxPage({ consumerId }), pending);
    assert.deepEqual(await reader.readDisplayProjection(), before);
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root, sessionId });
  t.after(() => cold.close());
  const options = { journal: cold, sessionId, parentSessionId: "" };
  const readSlots = cold.readRecordSlots.bind(cold);
  const decodedEvents = new Set();
  cold.readRecordSlots = async (query) => {
    const slots = await readSlots(query);
    for (const { mutation } of slots.values())
      if (mutation.collection === "events") decodedEvents.add(mutation.key);
    return slots;
  };
  const { result, work } = await observeStorageIo(root, async () => {
    await using reader = await openPartitionSessionReader(options);
    return reader.readDisplayProjection();
  });
  assert.deepEqual(result, before);
  assert.deepEqual([...decodedEvents].sort(), expectedEventIds.sort());
  t.diagnostic(`Cold display: ${work.readBytes} B, ${decodedEvents.size} decoded event`);
  await using reader = await openPartitionSessionReader(options);
  const delivered = await reader.readOutboxPage({ consumerId: "runtime-events" });
  assert.ok(delivered.after > 0);
  assert.deepEqual(delivered.events, []);
  assert.equal(
    (await reader.readPluginArtifact(envelope.payload)).eventId,
    envelope.identity.eventId,
  );
});
