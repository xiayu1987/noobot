/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import {
  readCommittedIndex,
  readCommittedValueMetadata,
  collectValueRecords,
  forbidRecordReads,
} from "./helpers/immutable-record-reads.js";
import test from "node:test";
import { mkdtemp, rm, rename } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle, SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { ImmutableSessionChanges } from "../../src/session/session-artifact-session/immutable-message-changes.js";
import { immutableCheckpointKey } from "../../src/session/session-artifact-session/immutable-checkpoint-index.js";
import { readImmutableTurnPage } from "../../src/session/session-artifact-session/immutable-message-reader.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  readImmutableCheckpoint,
  readImmutableCheckpointPage,
} from "../../src/session/session-artifact-session/immutable-checkpoint-reader.js";
import { exportImmutableSession } from "../../src/session/session-artifact-session/immutable-session-export.js";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { turnRecord } from "../helpers/turn-record.js";

const ts = "2026-01-01T00:00:00.000Z";
function message(uid, overrides = {}) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: uid,
    attachments: [],
    transferEnvelopes: [],
    ts,
    ...overrides,
  };
}
function toolMessages() {
  const call = message("call", {
    role: "assistant",
    type: "tool_call",
    modelMessageId: "model-call",
    presentationMessageId: "p1",
    chatPresentation: false,
    tool_calls: [
      { id: "read-1", type: "function", function: { name: "read_file", arguments: "{}" } },
    ],
  });
  delete call.userMessageId;
  delete call.messageOrigin;
  const result = message("result", {
    role: "tool",
    type: "tool_result",
    presentationMessageId: "p1",
    tool_call_id: "read-1",
    toolName: "read_file",
  });
  delete result.userMessageId;
  delete result.messageOrigin;
  return [call, result];
}
function checkpoint(overrides = {}) {
  return {
    userId: "admin",
    sessionId: "s1",
    dialogProcessId: "d1",
    turnScopeId: "t1",
    checkpointId: "cp1",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["m1"],
    summarizedMessageUids: ["m1"],
    retainedMessageUids: [],
    messages: [],
    ...overrides,
  };
}
async function fixture(t, messages = [message("m1")]) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-summary-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages,
      dialogOrder: messages.length
        ? [{ dialogProcessId: "d1", dialogOrdinal: 1, turnScopeId: "t1", userMessageUid: "m1" }]
        : [],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
}
async function commit(store, changes, operationId = "checkpoint") {
  return commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: "s1",
    expectedGeneration: (await store.snapshot()).generation,
    operationId,
    changes,
    committedAt: ts,
  });
}

test("checkpoint metadata uses one ordered batch across committed and pending messages", async (t) => {
  const store = await fixture(t, [message("m1"), message("m2")]);
  const calls = [];
  const read = ImmutableSessionChanges.prototype.getManyMetadata;
  t.mock.method(ImmutableSessionChanges.prototype, "getManyMetadata", function (collection, keys) {
    calls.push([collection, keys]);
    return read.call(this, collection, keys);
  });
  const changes = {
    messages: [message("pending")],
    summaryCheckpoints: [
      checkpoint({
        persistedMessageUids: ["pending", "m1"],
        summarizedMessageUids: ["m2", "m1"],
        retainedMessageUids: ["pending"],
        messages: [message("pending")],
      }),
    ],
  };
  const result = await commit(store, changes);
  assert.equal(result.result.summaryCheckpoints[0].markedCount, 2);
  assert.equal(
    calls.filter(
      ([collection, keys]) =>
        collection === "messages" &&
        JSON.stringify(keys) === JSON.stringify(["pending", "m1", "m2"]),
    ).length,
    1,
  );
  const current = await store.snapshot();
  assert.equal((await store.get(current, "messages", "m1")).message.summarized, true);
  assert.equal((await store.get(current, "messages", "m2")).message.summarized, true);
  assert.equal((await store.get(current, "messages", "pending")).message.summarized, false);
  calls.length = 0;
  const replay = await commit(store, changes, "retry-batch");
  assert.equal(replay.result.summaryCheckpoints[0].deduplicated, true);
  assert.deepEqual(calls, []);
  assert.deepEqual(await store.snapshot(), current);
});

test("successive checkpoints never read acknowledged message bodies or earlier receipts", async (t) => {
  const count = 16;
  const inputs = Array.from({ length: count }, (_, index) =>
    message(`increment-${index}`, { content: `${index}:` + "正文🙂".repeat(4096) }),
  );
  const retained = message("retained", { content: "retained evidence".repeat(4096) });
  const store = await fixture(t, [...inputs, retained]);
  const forbidden = new Set();
  let snapshot = await store.snapshot();
  const messageRoot = await readCommittedIndex(store, snapshot.root, "messages");
  for (const input of [...inputs, retained]) {
    const reference = await readCommittedIndex(store, messageRoot, input.messageUid);
    const metadata = await readCommittedValueMetadata(store, reference);
    for (const part of metadata.parts) await collectValueRecords(store, part.reference, forbidden);
  }
  for (const [revision, input] of inputs.entries()) {
    const cold = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
    setFsAdapter(await forbidRecordReads(cold, forbidden));
    try {
      const outcome = await commit(
        cold,
        {
          summaryCheckpoints: [
            checkpoint({
              checkpointId: `increment-cp-${revision}`,
              expectedCheckpointRevision: revision,
              persistedMessageUids: [retained.messageUid],
              summarizedMessageUids: [input.messageUid],
              retainedMessageUids: [retained.messageUid],
            }),
          ],
        },
        `increment-op-${revision}`,
      );
      const result = outcome.result.summaryCheckpoints[0];
      assert.equal(result.checkpointRevision, revision + 1);
      assert.equal(result.markedCount, 1);
      assert.deepEqual(result.receipt.persistedMessageUids, [retained.messageUid]);
      assert.deepEqual(result.receipt.summarizedMessageUids, [input.messageUid]);
      assert.deepEqual(result.receipt.retainedMessageUids, [retained.messageUid]);
    } finally {
      resetFsAdapter();
    }
    snapshot = await cold.snapshot();
    const root = await readCommittedIndex(cold, snapshot.root, "checkpoints");
    const reference = await readCommittedIndex(
      cold,
      root,
      immutableCheckpointKey("t1", `increment-cp-${revision}`),
    );
    await collectValueRecords(cold, reference, forbidden);
    const messages = await readCommittedIndex(cold, snapshot.root, "messages");
    await collectValueRecords(
      cold,
      await readCommittedIndex(cold, messages, input.messageUid),
      forbidden,
    );
  }
  const page = await readImmutableCheckpointPage({
    store,
    snapshot,
    turnScopeId: "t1",
    limit: count,
  });
  assert.equal(page.receipts.length, count);
  assert.equal(page.hasMore, false);
  assert.equal(
    (await store.get(snapshot, "messages", retained.messageUid)).message.summarized,
    false,
  );
});

test("summary metadata changes reuse content without opening any body record", async (t) => {
  const body = "independent content 中文".repeat(20000);
  const store = await fixture(t, [message("m1", { content: body })]);
  const previous = await store.snapshot();
  const root = await readCommittedIndex(store, previous.root, "messages");
  const reference = await readCommittedIndex(store, root, "m1");
  const before = await readCommittedValueMetadata(store, reference);
  assert.equal(before.parts.length, 1);
  const forbidden = await collectValueRecords(store, before.parts[0].reference);
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    await commit(store, { summaryCheckpoints: [checkpoint()] });
  } finally {
    resetFsAdapter();
  }
  const current = await store.snapshot();
  const nextRoot = await readCommittedIndex(store, current.root, "messages");
  const nextRef = await readCommittedIndex(store, nextRoot, "m1");
  const after = await readCommittedValueMetadata(store, nextRef);
  assert.deepEqual(after.parts, before.parts);
  assert.equal(after.value.message.summarized, true);
  assert.equal((await store.get(current, "messages", "m1")).message.content, body);
  assert.notEqual((await store.get(previous, "messages", "m1")).message.summarized, true);
});

test("attachment binding persists only metadata and a compact receipt without accessing content", async (t) => {
  const body = "attachment user body 中文".repeat(20000);
  const store = await fixture(t, [message("m1", { content: body })]);
  const previous = await store.snapshot();
  const reference = await readCommittedIndex(
    store,
    await readCommittedIndex(store, previous.root, "messages"),
    "m1",
  );
  const before = await readCommittedValueMetadata(store, reference);
  const forbidden = await collectValueRecords(store, before.parts[0].reference);
  const attachments = [
    {
      attachmentId: "a1",
      sessionId: "s1",
      attachmentSource: "user",
      name: "one.txt",
      mimeType: "text/plain",
    },
  ];
  const changes = {
    attachmentBinding: {
      userId: "admin",
      sessionId: "s1",
      turnScopeId: "t1",
      messageUid: "m1",
      commandId: "bind",
      expectedAggregateVersion: 0,
      attachments,
    },
  };
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    const first = await commit(store, changes, "binding");
    assert.deepEqual(first.result.attachmentBinding, {
      messageUid: "m1",
      aggregateVersion: 1,
      deduplicated: false,
    });
    const repeated = await commit(store, changes, "binding-command-retry");
    assert.equal(repeated.result.attachmentBinding.deduplicated, true);
    assert.equal((await store.snapshot()).generation, first.generation);
  } finally {
    resetFsAdapter();
  }
  const current = await store.snapshot();
  const next = await readCommittedIndex(
    store,
    await readCommittedIndex(store, current.root, "messages"),
    "m1",
  );
  const after = await readCommittedValueMetadata(store, next);
  assert.deepEqual(after.parts, before.parts);
  assert.deepEqual(after.value.message.attachments, attachments);
  assert.equal((await store.get(current, "messages", "m1")).message.content, body);
  assert.deepEqual((await store.get(previous, "messages", "m1")).message.attachments, []);
});

test("checkpoint flags, turn projection and indexed receipt publish together and preserve older reads", async (t) => {
  const store = await fixture(t);
  const previous = await store.snapshot();
  const result = await commit(store, { summaryCheckpoints: [checkpoint()] });
  const current = await store.snapshot();
  assert.equal(result.result.summaryCheckpoints[0].markedCount, 1);
  assert.equal((await store.get(current, "messages", "m1")).message.summarized, true);
  assert.notEqual((await store.get(previous, "messages", "m1")).message.summarized, true);
  assert.equal(
    (await store.get(current, "checkpoints", immutableCheckpointKey("t1", "cp1")))
      .checkpointRevision,
    1,
  );
  assert.equal(
    (await readImmutableTurnPage({ store, snapshot: current, turnScopeId: "t1" })).records[0]
      .message.summarized,
    true,
  );
  const duplicate = await commit(store, { summaryCheckpoints: [checkpoint()] }, "duplicate");
  assert.equal(duplicate.result.summaryCheckpoints[0].deduplicated, true);
  await assert.rejects(
    commit(store, { summaryCheckpoints: [checkpoint({ retainedMessageUids: ["m1"] })] }, "reused"),
    {
      code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_ID_REUSED,
    },
  );
});

test("cold checkpoint replay after completion preserves original receipts without reading bodies or publishing", async (t) => {
  const store = await fixture(t);
  const draft = message("m1");
  const changes = { messages: [draft], summaryCheckpoints: [checkpoint({ messages: [draft] })] };
  const first = await commit(store, changes);
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "complete-and-admit-later",
    changes: [
      {
        collection: "metadata",
        key: "lifecycle",
        value: { activeTurnScopeId: "later", sequence: 2 },
      },
      {
        collection: "lifecycle",
        key: "t1",
        value: turnRecord({ turnScopeId: "t1", dialogProcessId: "d1", state: "completed" }),
      },
      {
        collection: "lifecycle",
        key: "later",
        value: turnRecord({ turnScopeId: "later", dialogProcessId: "d1", sequence: 2 }),
      },
    ],
  });
  const snapshot = await store.snapshot();
  const root = await readCommittedIndex(store, snapshot.root, "messages");
  const reference = await readCommittedIndex(store, root, "m1");
  const { parts } = await readCommittedValueMetadata(store, reference);
  const forbidden = await collectValueRecords(store, parts[0].reference);
  const reopened = new ImmutableSessionStore({ sessionDir: store.sessionDir, sessionId: "s1" });
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    const replay = await commitSessionChanges({
      sessionDir: reopened.sessionDir,
      sessionId: "s1",
      expectedGeneration: snapshot.generation,
      operationId: "terminal-retry",
      changes,
      committedAt: "2026-11-02T00:00:00.000Z",
    });
    assert.equal(replay.result.summaryCheckpoints[0].deduplicated, true);
    assert.deepEqual(
      replay.result.summaryCheckpoints[0].receipt,
      first.result.summaryCheckpoints[0].receipt,
    );
    assert.deepEqual(
      replay.result.summaryCheckpoints[0].messageReceipts,
      first.result.summaryCheckpoints[0].messageReceipts,
    );
    assert.deepEqual(await reopened.snapshot(), snapshot);
    await assert.rejects(
      commit(
        reopened,
        { summaryCheckpoints: [checkpoint({ summarizedMessageUids: [] })] },
        "changed-terminal-retry",
      ),
      { code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_ID_REUSED },
    );
    assert.deepEqual(await reopened.snapshot(), snapshot);
  } finally {
    resetFsAdapter();
  }
});

test("tool pair closure rejects an omitted partner in either direction without scanning turn history", async (t) => {
  const store = await fixture(t, [message("m1"), ...toolMessages()]);
  const previous = await store.snapshot();
  for (const uid of ["call", "result"]) {
    await assert.rejects(
      commit(
        store,
        {
          summaryCheckpoints: [
            checkpoint({ persistedMessageUids: [], summarizedMessageUids: [uid] }),
          ],
        },
        `split-${uid}`,
      ),
      {
        code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT,
      },
    );
    assert.deepEqual(await store.snapshot(), previous);
  }
  const result = await commit(store, {
    summaryCheckpoints: [
      checkpoint({ persistedMessageUids: [], summarizedMessageUids: ["call", "result"] }),
    ],
  });
  assert.equal(result.result.summaryCheckpoints[0].markedCount, 2);
});

test("failed publication leaves checkpoint and flags unchanged and permits the same operation to retry", async (t) => {
  const store = await fixture(t);
  const previous = await store.snapshot();
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("injected failure"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(commit(store, { summaryCheckpoints: [checkpoint()] }), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), previous);
  assert.equal(await store.get(previous, "checkpointHeads", "t1"), null);
  await commit(store, { summaryCheckpoints: [checkpoint()] });
  assert.equal(
    (await store.get(await store.snapshot(), "checkpointHeads", "t1")).checkpointRevision,
    1,
  );
});

test("cold summary resolves requested UIDs and the named receipt without accessing unrelated or preceding bodies", async (t) => {
  const store = await fixture(t, [
    message("m1"),
    message("m2"),
    message("history", { turnScopeId: "history" }),
  ]);
  await commit(store, { summaryCheckpoints: [checkpoint()] });
  const snapshot = await store.snapshot();
  const forbidden = new Set();
  for (const uid of ["m1", "history"]) {
    const root = await readCommittedIndex(store, snapshot.root, "messages");
    const reference = await readCommittedIndex(store, root, uid);
    await collectValueRecords(store, reference, forbidden);
  }
  const reopened = new ImmutableSessionStore({ sessionDir: store.sessionDir, sessionId: "s1" });
  const next = checkpoint({
    checkpointId: "cp2",
    expectedCheckpointRevision: 1,
    persistedMessageUids: ["m2"],
    summarizedMessageUids: ["m2"],
  });
  setFsAdapter(await forbidRecordReads(store, forbidden));
  try {
    assert.equal(
      (await commit(reopened, { summaryCheckpoints: [next] }, "next")).result.summaryCheckpoints[0]
        .checkpointRevision,
      2,
    );
    assert.equal(
      (await commit(reopened, { summaryCheckpoints: [checkpoint()] }, "old-retry")).result
        .summaryCheckpoints[0].deduplicated,
      true,
    );
  } finally {
    resetFsAdapter();
  }
});

test("a checkpoint can resolve messages prepared in the same atomic delta and rolls them back on invalid UIDs", async (t) => {
  const store = await fixture(t, []);
  const previous = await store.snapshot();
  await assert.rejects(
    commit(store, {
      messages: [message("m1")],
      summaryCheckpoints: [checkpoint({ summarizedMessageUids: ["missing"] })],
    }),
    {
      code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING,
    },
  );
  assert.deepEqual(await store.snapshot(), previous);
  await commit(store, { messages: [message("m1")], summaryCheckpoints: [checkpoint()] });
  assert.equal(
    (await store.get(await store.snapshot(), "messages", "m1")).message.summarized,
    true,
  );
});

test("message and summary publication retries atomically without replaying an acknowledged message", async (t) => {
  const store = await fixture(t, []);
  const previous = await store.snapshot();
  const draft = message("m1");
  const changes = { messages: [draft], summaryCheckpoints: [checkpoint({ messages: [draft] })] };
  const retry = () =>
    commitSessionChanges({
      sessionDir: store.sessionDir,
      sessionId: "s1",
      expectedGeneration: previous.generation,
      operationId: "atomic-checkpoint",
      changes,
      committedAt: ts,
    });
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("head failure"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(retry(), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), previous);
  assert.equal(await store.get(previous, "messages", "m1"), null);
  assert.equal(await store.get(previous, "checkpointHeads", "t1"), null);
  await retry();
  const committed = await store.snapshot();
  assert.equal((await store.get(committed, "messages", "m1")).message.summarized, true);
  const replay = await retry();
  assert.equal(replay.replayed, true);
  assert.deepEqual(await store.snapshot(), committed);
  await commit(
    store,
    { messages: [message("m1", { content: "later edit", summarized: true })] },
    "later-edit",
  );
  const duplicate = await commit(store, changes, "response-lost-retry");
  assert.equal(duplicate.result.summaryCheckpoints[0].deduplicated, true);
  const current = await store.snapshot();
  const actual = (await store.get(current, "messages", "m1")).message;
  assert.equal(actual.summarized, true);
  assert.equal(actual.content, "later edit");
  await assert.rejects(
    commit(
      store,
      {
        messages: [message("m1", { content: "different request" })],
        summaryCheckpoints: [
          checkpoint({ messages: [message("m1", { content: "different request" })] }),
        ],
      },
      "conflicting-retry",
    ),
    { code: SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_ID_REUSED },
  );
  assert.deepEqual(await store.snapshot(), current);
});

test("checkpoint history remains pageable beyond the exported retry window and pins its generation", async (t) => {
  const store = await fixture(t);
  const count = QUANTITY_THRESHOLDS.contextProtocol.turnSummaryCheckpointReceiptLimit + 2;
  let pinned;
  for (let revision = 1; revision <= count; revision += 1) {
    await commit(
      store,
      {
        summaryCheckpoints: [
          checkpoint({
            checkpointId: `cp${revision}`,
            expectedCheckpointRevision: revision - 1,
            persistedMessageUids: [],
            summarizedMessageUids: [],
          }),
        ],
      },
      `checkpoint-${revision}`,
    );
    if (revision === 2) pinned = await store.snapshot();
  }
  const snapshot = await store.snapshot();
  const reopened = new ImmutableSessionStore({ sessionDir: store.sessionDir, sessionId: "s1" });
  const historical = await readImmutableCheckpoint(reopened, snapshot, "t1", "cp1");
  assert.equal(historical.checkpointRevision, 1);
  assert.equal(await readImmutableCheckpoint(reopened, pinned, "t1", `cp${count}`), null);
  const seen = [];
  let after = 0;
  let page;
  do {
    page = await readImmutableCheckpointPage({
      store: reopened,
      snapshot,
      turnScopeId: "t1",
      after,
      limit: 7,
    });
    assert.equal(page.generation, snapshot.generation);
    assert.ok(page.receipts.length <= 7);
    seen.push(...page.receipts.map((receipt) => receipt.checkpointRevision));
    after = page.cursor;
  } while (page.hasMore);
  assert.deepEqual(
    seen,
    Array.from({ length: count }, (_, i) => i + 1),
  );
  const oldPage = await readImmutableCheckpointPage({
    store: reopened,
    snapshot: pinned,
    turnScopeId: "t1",
  });
  assert.deepEqual(
    oldPage.receipts.map((receipt) => receipt.checkpointRevision),
    [1, 2],
  );
  assert.equal(oldPage.hasMore, false);
  const exported = await exportImmutableSession({ store: reopened, snapshot });
  assert.equal(exported.turnSummaryCheckpoints.t1.receipts.length, count - 2);
  assert.equal(exported.turnSummaryCheckpoints.t1.receipts[0].checkpointId, "cp3");
  assert.equal(exported.turnSummaryCheckpoints.t1.checkpointRevision, count);
});

test("checkpoint pagination bounds gaps and validates cursors and dangling order entries", async (t) => {
  const store = await fixture(t);
  for (let revision = 1; revision <= 3; revision += 1) {
    await commit(
      store,
      {
        summaryCheckpoints: [
          checkpoint({
            checkpointId: `cp${revision}`,
            expectedCheckpointRevision: revision - 1,
            persistedMessageUids: [],
            summarizedMessageUids: [],
          }),
        ],
      },
      `checkpoint-${revision}`,
    );
  }
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "legacy-gap",
    changes: [
      {
        collection: "checkpointOrder",
        key: immutableCheckpointKey("t1", immutableOrderKey(1)),
        remove: true,
      },
    ],
  });
  const snapshot = await store.snapshot();
  const readPage = (options = {}) =>
    readImmutableCheckpointPage({ store, snapshot, turnScopeId: "t1", ...options });
  assert.deepEqual(await readPage({ limit: 1 }), {
    generation: snapshot.generation,
    receipts: [],
    cursor: 1,
    hasMore: true,
  });
  assert.equal((await readPage({ after: 1, limit: 1 })).receipts[0].checkpointId, "cp2");
  assert.equal((await readPage({ after: 99 })).hasMore, false);
  assert.equal(await readPage({ turnScopeId: "missing" }), null);
  for (const options of [{ after: -1 }, { after: 0.5 }, { limit: 0 }, { limit: 257 }])
    await assert.rejects(readPage(options), TypeError);
  await store.commit({
    expectedGeneration: snapshot.generation,
    operationId: "dangling-order",
    changes: [
      {
        collection: "checkpointOrder",
        key: immutableCheckpointKey("t1", immutableOrderKey(2)),
        value: "missing",
      },
    ],
  });
  await assert.rejects(
    readPage({ snapshot: await store.snapshot(), after: 1, limit: 1 }),
    /invalid receipt/,
  );
});

test("checkpoint append replay returns its original version after later edits without appending twice", async (t) => {
  const store = await fixture(t);
  const seeded = await commit(store, { messages: [message("m1")] }, "seed-version");
  const initial = seeded.result.messageReceipts[0];
  const append = {
    messageUid: "m1",
    dialogProcessId: "d1",
    turnScopeId: "t1",
    expectedContentReference: initial.contentReference,
    content: "🙂 suffix",
  };
  const changes = {
    messageContentAppends: [append],
    summaryCheckpoints: [checkpoint({ messageContentAppends: [append] })],
  };
  const originalRequest = {
    sessionDir: store.sessionDir,
    sessionId: "s1",
    expectedGeneration: seeded.generation,
    operationId: "append-checkpoint",
    changes,
    committedAt: ts,
  };
  const first = await commitSessionChanges(originalRequest);
  const receipts = first.result.summaryCheckpoints[0].messageReceipts;
  assert.equal(receipts.length, 1);
  assert.notEqual(receipts[0].contentReference, initial.contentReference);
  assert.deepEqual(receipts, first.result.messageReceipts);
  await commit(
    store,
    { messages: [message("m1", { content: "later replacement" })] },
    "later-edit",
  );
  const beforeReplay = await store.snapshot();
  const cold = new ImmutableSessionStore({ sessionDir: store.sessionDir, sessionId: "s1" });
  const sameOperation = await commitSessionChanges(originalRequest);
  assert.equal(sameOperation.replayed, true);
  assert.deepEqual(sameOperation.result.summaryCheckpoints[0].messageReceipts, receipts);
  const duplicate = await commit(cold, changes, "independent-checkpoint-retry");
  assert.equal(duplicate.aborted, true);
  assert.equal(duplicate.result.summaryCheckpoints[0].deduplicated, true);
  assert.deepEqual(duplicate.result.summaryCheckpoints[0].messageReceipts, receipts);
  assert.deepEqual(await cold.snapshot(), beforeReplay);
  assert.equal(
    (await cold.get(beforeReplay, "messages", "m1")).message.content,
    "later replacement",
  );
});
