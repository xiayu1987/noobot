/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSessionDisplayPublicationRow,
  createSessionDisplayStats,
  describeSessionDisplayMessageRow,
  emptySessionDisplayOrderPage,
  encodeSessionDisplayOrderKey,
  readSessionDisplayPublicationWindow,
  stageSessionDisplayPublication,
} from "@noobot/session-protocol/session-reader";

function sourceStatistics(count) {
  return {
    messageCount: count,
    injectedMessageCount: 0,
    toolLogCount: 0,
    displayToolLogCount: 0,
    unassignedToolArtifactCount: 0,
    conflictedToolArtifactCount: 0,
    thinkingMessageCount: 0,
  };
}

function stats(count, thinking = 0, attachments = 0) {
  return createSessionDisplayStats({
    ...sourceStatistics(count),
    displayMessageCount: count,
    thinkingMessageCount: thinking,
    attachmentCount: attachments,
  });
}

function overlay(base) {
  const pages = new Map(base ? base.pages : [["", emptySessionDisplayOrderPage()]]);
  const rows = new Map(base?.rows);
  let statistics = base ? base.getStatistics() : stats(0);
  return {
    pages,
    rows,
    order: {
      get: (key) => pages.get(key) ?? null,
      set: (key, value) => pages.set(key, value),
      remove: (key) => pages.delete(key),
    },
    getRow: (key) => rows.get(key) ?? null,
    setRow: (key, value) => rows.set(key, value),
    removeRow: (key) => rows.delete(key),
    describeRow: (row, jsonBytes) => ({ jsonBytes, read: () => row }),
    getStatistics: () => statistics,
    setStatistics: (value) => {
      statistics = value;
    },
  };
}

const order = (ordinal) => [0, ordinal, 0];
const row = (ordinal, attachments = []) =>
  createSessionDisplayPublicationRow({
    messageUid: `m${ordinal}`,
    sessionOrdinal: ordinal,
    attachments,
  });
const countAttachments = (row) => row.attachments.length;

test("the display row uses the retained message facts and references its versioned body", () => {
  const content = '"quoted" \u{1f680}\n';
  const identity = {
    messageUid: "m1",
    role: "assistant",
    modelMessageId: "model-1",
    presentationMessageId: "presentation-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
  };
  const published = createSessionDisplayPublicationRow({
    ...identity,
    sessionOrdinal: 1,
    content: "obsolete",
    summarized: false,
    hasThinkingDetails: true,
    ts: "obsolete",
  });
  assert.deepEqual(published, { messageUid: "m1", sessionOrdinal: 1 });
  const descriptor = describeSessionDisplayMessageRow(published, {
    message: { ...identity, sessionId: "session-1", summarized: true, ts: "retained-time" },
    hasThinkingDetails: true,
    contentReference: "version-1",
    contentBytes: Buffer.byteLength(JSON.stringify(content)),
  });
  const expected = {
    ...identity,
    sessionOrdinal: 1,
    contentReference: "version-1",
    contentBytes: Buffer.byteLength(JSON.stringify(content)),
    summarized: true,
    hasThinkingDetails: true,
    ts: "retained-time",
  };
  assert.equal(descriptor.jsonBytes, Buffer.byteLength(JSON.stringify(expected)));
  assert.deepEqual(descriptor.read(), expected);
});

test("published and retained message rows reject embedded or missing message facts", async () => {
  for (const invalid of [
    { messageUid: "m1" },
    { ...row(1), content: "embedded" },
    { ...row(1), summarized: false },
    { ...row(1), hasThinkingDetails: true },
    { ...row(1), ts: "stale" },
    { ...row(1), turnScopeId: "stale" },
    { ...row(1), presentationMessageId: "stale" },
  ]) {
    const current = overlay();
    const corrupt = { code: "SESSION_STORAGE_CORRUPT" };
    await assert.rejects(
      stageSessionDisplayPublication(current, {
        changes: [{ order: order(1), existed: false, row: invalid }],
        sourceStatistics: sourceStatistics(1),
        countAttachments,
        artifactAttachmentDelta: 0,
      }),
      corrupt,
    );
    assert.equal(current.rows.size, 0);
    await stageSessionDisplayPublication(current, {
      changes: [{ order: order(1), existed: false, row: row(1) }],
      sourceStatistics: sourceStatistics(1),
      countAttachments,
      artifactAttachmentDelta: 0,
    });
    current.setRow(encodeSessionDisplayOrderKey(order(1)), invalid);
    await assert.rejects(collectWindow(current, { after: 0, length: 1 }), corrupt);
  }
});

async function collectWindow(store, bounds) {
  const { stats, messages } = await readSessionDisplayPublicationWindow(store, bounds);
  return { stats, messages: await Array.fromAsync(messages, (entry) => entry.read()) };
}

test("the final row publication replaces, retires and inserts rows relative to a retained view", async () => {
  const before = overlay();
  const retired = row(1, ["retired"]);
  await stageSessionDisplayPublication(before, {
    changes: [retired, row(2), row(3)].map((row, i) => ({
      order: order(i + 1),
      existed: false,
      row,
    })),
    sourceStatistics: sourceStatistics(3),
    countAttachments,
    artifactAttachmentDelta: 0,
  });
  const after = overlay(before);
  const replacement = row(2, ["new-a", "new-b"]);
  await stageSessionDisplayPublication(after, {
    changes: [
      { order: order(1), existed: true, row: null },
      { order: order(2), existed: true, row: replacement },
      { order: order(4), existed: false, row: row(4) },
    ],
    sourceStatistics: { ...sourceStatistics(3), thinkingMessageCount: 1 },
    countAttachments,
    artifactAttachmentDelta: 0,
  });
  assert.deepEqual(await collectWindow(before, { after: 0, length: 2 }), {
    stats: stats(3, 0, 1),
    messages: [retired, row(2)],
  });
  assert.deepEqual(await collectWindow(after, { after: 0, length: 2 }), {
    stats: stats(3, 1, 2),
    messages: [replacement, row(3)],
  });
  assert.deepEqual(await collectWindow(after, { after: 2, length: 1 }), {
    stats: stats(3, 1, 2),
    messages: [row(4)],
  });
});

test("publication rejects caller-supplied row statistics before writing the overlay", async () => {
  const before = overlay();
  const staged = overlay(before);
  await assert.rejects(
    stageSessionDisplayPublication(staged, {
      changes: [{ order: order(1), existed: false, row: row(1) }],
      sourceStatistics: { ...sourceStatistics(0), attachmentCount: 9 },
      countAttachments,
      artifactAttachmentDelta: 0,
    }),
    /derives final row statistics/,
  );
  assert.equal(staged.rows.size, 0);
  assert.deepEqual(staged.getStatistics(), stats(0));
  assert.deepEqual(await collectWindow(before, { after: 0, length: 0 }), {
    stats: stats(0),
    messages: [],
  });
});

test("publication rejects an omitted artifact attachment delta before reading storage", async () => {
  const store = new Proxy({}, { get: () => assert.fail("invalid publication accessed storage") });
  await assert.rejects(
    stageSessionDisplayPublication(store, {
      changes: [],
      sourceStatistics: sourceStatistics(0),
      countAttachments,
    }),
    /requires an integer artifact attachment delta/,
  );
});

test("ranked rows are looked up only when pulled by the consumer", async () => {
  const store = overlay();
  await stageSessionDisplayPublication(store, {
    changes: [1, 2].map((ordinal) => ({
      order: order(ordinal),
      existed: false,
      row: row(ordinal),
    })),
    sourceStatistics: sourceStatistics(2),
    countAttachments,
    artifactAttachmentDelta: 0,
  });
  const reads = [];
  const { messages } = await readSessionDisplayPublicationWindow(
    {
      ...store,
      getRow(key) {
        reads.push(key);
        return store.getRow(key);
      },
    },
    { after: 0, length: 2 },
  );
  assert.deepEqual(reads, []);
  for await (const message of messages) {
    assert.deepEqual(reads, [encodeSessionDisplayOrderKey(order(1))]);
    assert.equal(message.jsonBytes, Buffer.byteLength(JSON.stringify(row(1))));
    assert.deepEqual(await message.read(), row(1));
    break;
  }
  assert.deepEqual(reads, [encodeSessionDisplayOrderKey(order(1))]);
});

test("a replacement does not rewrite unchanged statistics", async () => {
  const current = overlay();
  const orderKey = order(1);
  const options = {
    sourceStatistics: sourceStatistics(1),
    countAttachments,
    artifactAttachmentDelta: 0,
  };
  await stageSessionDisplayPublication(current, {
    ...options,
    changes: [{ order: orderKey, existed: false, row: row(1) }],
  });
  await stageSessionDisplayPublication(
    {
      ...current,
      setStatistics: () => assert.fail("unchanged statistics were written"),
    },
    { ...options, changes: [{ order: orderKey, existed: true, row: row(2) }] },
  );
  assert.deepEqual(await collectWindow(current, { after: 0, length: 1 }), {
    stats: stats(1),
    messages: [row(2)],
  });
});

test("inconsistent prior row membership rejects publication before any overlay writes", async () => {
  const current = overlay();
  const key = encodeSessionDisplayOrderKey(order(1));
  const existing = { order: order(1), existed: true };
  await stageSessionDisplayPublication(current, {
    changes: [{ ...existing, existed: false, row: row(1) }],
    sourceStatistics: sourceStatistics(1),
    countAttachments,
    artifactAttachmentDelta: 0,
  });
  for (const { old, change } of [
    { old: 2, change: { ...existing, row: row(1, ["replacement"]) } },
    { old: null, change: { ...existing, row: null } },
    { old: row(1), change: { ...existing, existed: false, row: row(1) } },
  ]) {
    const staged = overlay(change.existed ? current : undefined);
    if (old === null) staged.removeRow(key);
    else staged.setRow(key, old);
    const before = overlay(staged);
    await assert.rejects(
      stageSessionDisplayPublication(staged, {
        changes: [{ order: order(2), existed: false, row: row(2) }, change],
        sourceStatistics: sourceStatistics(2),
        countAttachments,
        artifactAttachmentDelta: 0,
      }),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
    assert.deepEqual(staged.pages, before.pages);
    assert.deepEqual(staged.rows, before.rows);
    assert.deepEqual(staged.getStatistics(), before.getStatistics());
  }
});

test("ranking, row and statistics corruption fail closed, including a statistics-only update", async () => {
  const current = overlay();
  await stageSessionDisplayPublication(current, {
    changes: [{ order: order(1), existed: false, row: row(1) }],
    sourceStatistics: sourceStatistics(1),
    countAttachments,
    artifactAttachmentDelta: 0,
  });
  const missingRow = overlay(current);
  missingRow.removeRow(encodeSessionDisplayOrderKey(order(1)));
  const corrupt = { code: "SESSION_STORAGE_CORRUPT" };
  await assert.rejects(collectWindow(missingRow, { after: 0, length: 1 }), corrupt);
  await assert.rejects(
    stageSessionDisplayPublication(missingRow, {
      changes: [{ order: order(1), existed: true, row: row(1) }],
      sourceStatistics: sourceStatistics(1),
      countAttachments,
      artifactAttachmentDelta: 0,
    }),
    corrupt,
  );
  const missingRoot = overlay(current);
  missingRoot.pages.clear();
  await assert.rejects(
    stageSessionDisplayPublication(missingRoot, {
      changes: [],
      sourceStatistics: sourceStatistics(1),
      countAttachments,
      artifactAttachmentDelta: 0,
    }),
    corrupt,
  );
  current.setStatistics(null);
  await assert.rejects(collectWindow(current, { after: 0, length: 1 }), corrupt);
});
