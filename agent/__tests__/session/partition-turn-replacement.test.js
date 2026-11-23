/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

test("replacement finds the nearest natural user in the same dialog and publishes once across pages", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t, { transactionBytes: 4 * 1024 });
  const repository = openTestMessages(journal, sessionId);
  const continued = { ...scope, turnScopeId: "turn-2" };
  const fresh = { dialogProcessId: "dialog-new", turnScopeId: "turn-new" };
  const natural = (key) => {
    const {
      modelMessageId: _model,
      presentationMessageId: _presentation,
      ...fields
    } = message(sessionId, key);
    return { ...fields, role: "user", userMessageId: key, messageOrigin: "natural" };
  };
  const commit = async (id, changes) => {
    try {
      return await repository.commit(await prepare(journal, repository, id, changes));
    } catch (cause) {
      throw new Error(`Replacement fixture failed while committing ${id}: ${cause.message}`, {
        cause,
      });
    }
  };
  await commit("seed", { messages: [natural("previous"), natural("nearest")] });
  for (let i = 0; i < 10; i += 1)
    await commit(`append-${i}`, {
      messages: [
        {
          ...message(sessionId, `continued-${i}`),
          ...continued,
          injectedMessage: true,
          injectedMessageType: "guidance",
          chatPresentation: false,
          rawModelContent: [{ type: "text", text: "x".repeat(2048) }],
        },
      ],
    });
  const input = {
    turnReplacement: {
      command: {
        commandId: "replace",
        anchor: { turnScopeId: continued.turnScopeId },
        turnScopeId: fresh.turnScopeId,
        newContent: "replacement",
        attachments: [],
      },
      identity: {
        dialogProcessId: fresh.dialogProcessId,
        messageUid: "replacement",
        userMessageId: "user-replacement",
      },
    },
  };
  const request = await prepare(journal, repository, "replace-operation", input);
  const open = (journal) => openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  const selection = {
    terminalLimit: 0,
    reconcileTurnScopeIds: [continued.turnScopeId, fresh.turnScopeId],
  };
  await using oldReader = await open(journal);
  let result;
  const uids = async (reader, snapshot, turn) =>
    (await reader.readTurnPage({ snapshot, ...turn, cursor: null, limit: 8 })).entries.map(
      ({ message: entry }) => entry.messageUid,
    );
  await journal.usingSnapshot(async (old) => {
    const oldCounts = { messageCount: 12, injectedMessageCount: 10, toolLogCount: 0 };
    assert.deepEqual(await repository.readDisplaySourceCounts({ snapshot: old }), oldCounts);
    const publications = journal.work.publications;
    result = await repository.commit(request);
    assert.equal(journal.work.publications, publications + 1);
    assert.deepEqual(
      result.result.turnReplacement.receipt.result.turnReplacement.replacedTurnScopeIds,
      [scope.turnScopeId, continued.turnScopeId],
    );
    assert.deepEqual(await uids(repository, old, scope), ["previous", "nearest"]);
    assert.deepEqual(await repository.readDisplaySourceCounts({ snapshot: old }), oldCounts);
    await journal.usingSnapshot(async (snapshot) => {
      assert.deepEqual(await uids(repository, snapshot, scope), ["previous"]);
      assert.deepEqual(await uids(repository, snapshot, fresh), ["replacement"]);
    });
  });
  const before = await oldReader.readLifecycleSource(selection);
  assert.deepEqual(before.turnLifecycle.replacedTurns, {});
  assert.equal(before.generation, oldReader.generation);
  await oldReader.close();
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await using current = await open(reopened);
  const after = await current.readLifecycleSource(selection);
  assert.equal(after.generation, current.generation);
  assert.ok(after.aggregateVersion > before.aggregateVersion);
  assert.deepEqual(Object.keys(after.turnLifecycle.replacedTurns), [continued.turnScopeId]);
  assert.equal(
    after.turnLifecycle.replacedTurns[continued.turnScopeId].replacementTurnScopeId,
    fresh.turnScopeId,
  );
  await assert.rejects(
    current.readLifecycleSource({
      ...selection,
      reconcileTurnScopeIds: Array(101).fill("known-turn"),
    }),
    TypeError,
  );
  const reader = openTestMessages(reopened, sessionId);
  assert.deepEqual(await reader.commit(request), { ...result, replayed: true });
  await reader.commit(
    await prepare(reopened, reader, "append-after-truncate", {
      messages: [message(sessionId, "retained-dialog-append")],
    }),
  );
  await reopened.usingSnapshot(async (snapshot) => {
    assert.deepEqual(await uids(reader, snapshot, scope), ["previous", "retained-dialog-append"]);
    assert.deepEqual(await reader.readDisplaySourceCounts({ snapshot }), {
      messageCount: 3,
      injectedMessageCount: 0,
      toolLogCount: 0,
    });
  });
});
