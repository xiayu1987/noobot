/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { bindCurrentTurnPersistence } from "../../../src/bot/execution/runner/current-turn-persistence.js";
import { createTestMessagePersistenceReceipts } from "../../helpers/message-persistence-receipts.js";

const identity = { sessionId: "s1", dialogProcessId: "d1", turnScopeId: "t1" };
const pageSize = QUANTITY_THRESHOLDS.sessionStorage.messagePageSize;
const message = (index) => ({
  ...identity,
  messageUid: `m${index}`,
  role: "assistant",
  content: `body-${index}`,
});

function setup(count, append) {
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore(
      Array.from({ length: count }, (_, i) => message(i)),
    ),
  };
  let generation = 0;
  bindCurrentTurnPersistence({
    dispatchRuntime: runtime,
    ...identity,
    appendAgentMessages: async (input) => {
      await append(input, runtime);
      return createTestMessagePersistenceReceipts(input, ++generation);
    },
  });
  return runtime;
}

test("flush confirms consecutive bounded pages without repeating acknowledged messages", async () => {
  const pages = [];
  const runtime = setup(pageSize * 2 + 3, async ({ messages }) => {
    pages.push(messages.map(({ messageUid }) => messageUid));
  });
  await runtime.persistCurrentTurnMessages();
  assert.deepEqual(
    pages.map((page) => page.length),
    [pageSize, pageSize, 3],
  );
  assert.equal(new Set(pages.flat()).size, pageSize * 2 + 3);
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
  await runtime.persistCurrentTurnMessages();
  assert.equal(pages.length, 3);
});

test("concurrent revisions beyond a flush boundary remain pending for the next flush", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const pages = [];
  const runtime = setup(pageSize + 2, async ({ messages }) => {
    pages.push(messages.map(({ messageUid, content }) => ({ messageUid, content })));
    if (pages.length === 1) {
      entered.resolve();
      await release.promise;
    }
  });
  const first = runtime.persistCurrentTurnMessages();
  await entered.promise;
  runtime.currentTurnMessages.updateByUid("m0", { content: "new first" });
  runtime.currentTurnMessages.updateByUid(`m${pageSize}`, { content: "new unselected" });
  runtime.currentTurnMessages.push(message(pageSize + 2));
  release.resolve();
  await first;
  assert.deepEqual(
    pages.map((page) => page.length),
    [pageSize, 1],
  );
  assert.equal(pages[1][0].messageUid, `m${pageSize + 1}`);
  assert.deepEqual(
    runtime.currentTurnMessages.readPendingChanges().entries.map(({ messageUid }) => messageUid),
    ["m0", `m${pageSize}`, `m${pageSize + 2}`],
  );
  await runtime.persistCurrentTurnMessages();
  assert.deepEqual(
    pages[2].map(({ content }) => content),
    ["new first", "new unselected", `body-${pageSize + 2}`],
  );
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
});

test("failed later page retries the same submission and body before selecting newer revisions", async () => {
  const calls = [];
  const runtime = setup(pageSize + 1, async (input) => {
    calls.push(input);
    if (calls.length === 2) throw new Error("uncertain later page");
  });
  await assert.rejects(runtime.persistCurrentTurnMessages(), /uncertain later page/);
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 1);
  runtime.currentTurnMessages.updateByUid(`m${pageSize}`, { content: "after failed write" });
  await runtime.persistCurrentTurnMessages();
  assert.equal(calls.length, 4);
  assert.strictEqual(calls[2].submission, calls[1].submission);
  assert.strictEqual(calls[2].changes, calls[1].changes);
  assert.deepEqual(calls[2].messages, calls[1].messages);
  assert.equal(calls[2].messages[0].content, `body-${pageSize}`);
  assert.equal(calls[3].messages[0].content, "after failed write");
  assert.notStrictEqual(calls[3].submission, calls[2].submission);
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
});

test("removing and reintroducing an unselected UID cannot cross the fixed revision boundary", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const pages = [];
  const runtime = setup(pageSize + 1, async ({ messages }) => {
    pages.push(messages);
    if (pages.length === 1) {
      entered.resolve();
      await release.promise;
    }
  });
  const first = runtime.persistCurrentTurnMessages();
  await entered.promise;
  runtime.currentTurnMessages.replaceAll(Array.from({ length: pageSize }, (_, i) => message(i)));
  runtime.currentTurnMessages.push({ ...message(pageSize), content: "recreated" });
  release.resolve();
  await first;
  assert.equal(pages.length, 1);
  await runtime.persistCurrentTurnMessages();
  assert.equal(pages.at(-1).at(-1).content, "recreated");
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
});
