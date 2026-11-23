/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { requirePartitionContextDescriptor } from "../src/partition-context-index.js";
import { preparePartitionDialogs } from "../src/partition-session-dialogs.js";
import { readPartitionDialog, requirePartitionDialog } from "../src/partition-session-state.js";

function dialog(contextCandidates) {
  return {
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    dialogOrdinal: 1,
    userMessageUid: "user",
    latestUserMessageUid: "later-user",
    messageCount: 2,
    turnCount: 1,
    contextCandidates,
  };
}

for (const contextCandidates of [
  undefined,
  { count: 1, directory: { ordinals: [] } },
  { count: 0, directory: { ordinals: [1] } },
  { count: 1, directory: { ordinals: [1, 2] } },
  { count: 0, directory: { slots: [0] } },
  { count: 2, directory: { ordinals: [2, 1] } },
  { count: 1, directory: { ordinals: [1] }, dialogOrdinal: 1 },
]) {
  test(`dialog rejects missing or inconsistent context authority: ${JSON.stringify(contextCandidates)}`, async () => {
    const stored = dialog(contextCandidates);
    assert.throws(() => requirePartitionDialog(stored, "dialog"), {
      code: "SESSION_STORAGE_CORRUPT",
    });
    await assert.rejects(
      readPartitionDialog(async () => new Map([["dialog", { value: stored }]]), "dialog"),
      { code: "SESSION_STORAGE_CORRUPT" },
    );
  });
}

test("dialog rejects candidate membership larger than message membership", () => {
  const contextCandidates = { count: 3, directory: { ordinals: [1, 2, 3] } };
  assert.equal(requirePartitionContextDescriptor(contextCandidates), contextCandidates);
  assert.throws(() => requirePartitionDialog(dialog(contextCandidates), "dialog"), {
    code: "SESSION_STORAGE_CORRUPT",
  });
});

test("a registered dialog user is independent of the natural-user tail", () => {
  const stored = dialog({ count: 0, directory: { ordinals: [] } });
  requirePartitionDialog({ ...stored, latestUserMessageUid: null }, "dialog");
  requirePartitionDialog({ ...stored, userMessageUid: "" }, "dialog");
  for (const latestUserMessageUid of [undefined, ""]) {
    assert.throws(() => requirePartitionDialog({ ...stored, latestUserMessageUid }, "dialog"), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  }
});

test("dialog returns only its public identity facts without leaking or copying the candidate directory", async () => {
  const stored = dialog({ count: 2, directory: { ordinals: [1, 2] } });
  assert.equal(requirePartitionDialog(stored, "dialog"), stored);
  let reads = 0;
  const result = await readPartitionDialog(async (query) => {
    reads += 1;
    assert.deepEqual(query, { collection: "dialogs", keys: ["dialog"] });
    return new Map([["dialog", { value: stored }]]);
  }, "dialog");
  assert.equal(reads, 1);
  assert.deepEqual(result, {
    dialogProcessId: "dialog",
    turnScopeId: "turn",
    dialogOrdinal: 1,
    userMessageUid: "user",
  });
});

test("dialog validation accepts a split candidate directory without traversing its cold pages", () => {
  const stored = dialog({ count: 300, directory: { slots: [0, 1] } });
  stored.messageCount = 300;
  assert.equal(requirePartitionDialog(stored, "dialog"), stored);
});

test("offline dialog replay accepts source ordinals out of order without changing the high-water mark", async () => {
  const view = {
    getLatestMany: async ({ collection, keys }) =>
      new Map(
        keys.map((key) => [key, collection === "metadata" ? { mutation: { value: 8 } } : null]),
      ),
  };
  const replay = async (dialogProcessId, importedDialogOrdinal) => {
    const mutations = [];
    await preparePartitionDialogs(view, {
      messages: [
        {
          dialogProcessId,
          turnScopeId: dialogProcessId,
          messageUid: "user",
          role: "user",
          messageOrigin: "internal",
        },
      ],
      turns: new Map([[dialogProcessId, null]]),
      mutations,
      sourceDialog: {
        dialogProcessId,
        dialogOrdinal: importedDialogOrdinal,
        userMessageUid: "user",
      },
    });
    assert.equal(
      mutations.some(({ collection }) => collection === "metadata"),
      false,
    );
    const { value } = mutations.find(({ collection }) => collection === "dialogs");
    assert.equal(value.userMessageUid, "user");
    assert.equal(value.latestUserMessageUid, null);
    return value.dialogOrdinal;
  };
  assert.equal(await replay("later", 7), 7);
  assert.equal(await replay("earlier", 3), 3);
  await assert.rejects(replay("invalid", 9), { code: "SESSION_STORAGE_CORRUPT" });
});
