/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionMessagePreviewLimits } from "@noobot/session-protocol/message-preview";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { sessionSummaryMethods } from "../../src/session/repositories/file-system-session-repository/summary-methods.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
} from "./partition-session-messages.test-helpers.js";

test("repository summary reads the visible partition tail from a fixed snapshot", async (t) => {
  const { journal, root, sessionId } = await createMessageCase(t);
  const repository = openTestMessages(journal, sessionId);
  const open = (source) =>
    openPartitionSessionReader({ journal: source, sessionId, parentSessionId: "" });
  const read = async (source = journal) => {
    await using reader = await open(source);
    return sessionSummaryMethods._buildSessionSummaryFromReader(reader);
  };
  const empty = await read();
  assert.equal(empty.messageCount, 0);
  assert.equal(empty.lastMessage, null);

  const tailScope = { turnScopeId: "tail-turn", dialogProcessId: "tail-dialog" };
  const prefix = "\\".repeat(sessionMessagePreviewLimits().chars - 1);
  const commit = async (operationId, changes) =>
    repository.commit(await prepare(journal, repository, operationId, changes));
  await commit("seed-retained", { messages: [message(sessionId, "retained")] });
  const created = await commit("seed-tail", {
    messages: [{ ...message(sessionId, "removed"), ...tailScope, content: `${prefix}\u{1f680}` }],
  });
  let [receipt] = created.result.messageReceipts;
  for (let index = 0; index < 3; index += 1) {
    const appended = await commit(`append-tail-${index}`, {
      messageContentAppends: [
        {
          ...tailScope,
          messageUid: "removed",
          owner: receipt.owner,
          expectedContentReference: receipt.contentReference,
          content: "x".repeat(800),
        },
      ],
    });
    [receipt] = appended.result.messageReceipts;
  }
  {
    await using pinned = await open(journal);
    const before = await sessionSummaryMethods._buildSessionSummaryFromReader(pinned);
    assert.equal(before.messageCount, 2);
    assert.equal(before.lastMessage.messageUid, "removed");
    assert.equal(before.lastMessage.content, prefix);
    assert.equal(before.lastMessage.contentTruncated, true);

    await repository.commit(
      await prepare(journal, repository, "delete-list-tail", {
        messageDeletion: {
          commandId: "delete-list-tail",
          anchor: { turnScopeId: tailScope.turnScopeId },
        },
      }),
    );
    const after = await read();
    assert.equal(after.messageCount, 1);
    assert.equal(after.lastMessage.messageUid, "retained");
    assert.equal(after.lastMessage.contentTruncated, false);
    assert.deepEqual(await sessionSummaryMethods._buildSessionSummaryFromReader(pinned), before);
  }

  await repository.commit(
    await prepare(journal, repository, "reuse-list-position", {
      messages: [message(sessionId, "appended")],
    }),
  );
  const latest = await read();
  assert.equal(latest.messageCount, 2);
  assert.equal(latest.lastMessage.messageUid, "appended");
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  assert.deepEqual(await read(reopened), latest);
});
