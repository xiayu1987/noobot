/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { readPartitionMutationProjection } from "../../src/session/partition-storage/partition-mutation-projection.js";
import {
  openPartitionSessionReader,
  withPartitionSessionReader,
} from "../../src/session/partition-storage/partition-session-reader.js";
import {
  deleteFromMessage,
  replaceTurn,
} from "../../src/session/services/session-message-service/turn-mutations.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
  committedAt,
} from "./partition-session-messages.test-helpers.js";

test("business replacement and deletion retain original transaction projections after later deletion and cold replay", async (t) => {
  const fixture = await createMessageCase(t);
  let journal = fixture.journal;
  const { sessionId, root } = fixture;
  const writer = openTestMessages(journal, sessionId);
  const natural = (uid) => {
    const {
      modelMessageId: _model,
      presentationMessageId: _presentation,
      ...value
    } = message(sessionId, uid);
    return { ...value, role: "user", userMessageId: uid, messageOrigin: "natural" };
  };
  await writer.commit(
    await prepare(journal, writer, "seed", { messages: [natural("first"), natural("anchor")] }),
  );
  const options = () => ({ journal, sessionId, parentSessionId: "" });
  const service = {
    now: () => committedAt,
    allocateDialogProcessId: () => "replacement-dialog",
    sessionRepo: {
      withSessionReader: async (_userId, requested, run) => {
        assert.equal(requested, sessionId);
        return withPartitionSessionReader(options(), (reader, commitChanges, readCurrent) =>
          run({ reader, commitChanges, readCurrent }),
        );
      },
    },
  };
  const replace = {
    userId: "fixture",
    sessionId,
    commandId: "replace",
    anchor: { turnScopeId: scope.turnScopeId },
    turnScopeId: "replacement-turn",
    newContent: '原始🙂\\正文\n"',
    attachments: [],
  };
  let original;
  {
    await using before = await openPartitionSessionReader(options());
    assert.equal(await before.readMutationProjection("replace"), null);
    await replaceTurn.call(service, replace);
    assert.equal(await before.readMutationProjection("replace"), null);
    await using after = await openPartitionSessionReader(options());
    original = await after.readMutationProjection("replace");
    assert.equal(original.messages[0].message.content, replace.newContent);
    assert.deepEqual(original.messageSuffix, { firstOrdinal: 1, previousMessageCount: 2 });
    assert.equal(original.metadata.aggregateVersion, original.receipt.aggregateVersion);
    assert.ok(original.replacements.length > 0);
    await assert.rejects(after.readMutationProjection(" invalid "), TypeError);
  }
  const deletion = {
    userId: "fixture",
    sessionId,
    commandId: "delete",
    anchor: { turnScopeId: replace.turnScopeId },
  };
  await deleteFromMessage.call(service, deletion);
  let deleted;
  {
    await using after = await openPartitionSessionReader(options());
    deleted = await after.readMutationProjection("delete");
    assert.deepEqual(deleted.messages, []);
    assert.deepEqual(await after.readMutationProjection("replace"), original);
  }
  await journal.close();
  journal = await PartitionJournal.open({ root, sessionId });
  t.after(() => journal.close());
  const publications = journal.work.publications;
  await replaceTurn.call(service, replace);
  await deleteFromMessage.call(service, deletion);
  assert.equal(journal.work.publications, publications);
  await using reopened = await openPartitionSessionReader(options());
  assert.deepEqual(await reopened.readMutationProjection("replace"), original);
  assert.deepEqual(await reopened.readMutationProjection("delete"), deleted);
});

test("mutation projection rejects missing and conflicting original transaction evidence", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const writer = openTestMessages(journal, sessionId);
  const {
    modelMessageId: _model,
    presentationMessageId: _presentation,
    ...fields
  } = message(sessionId, "anchor");
  await writer.commit(
    await prepare(journal, writer, "seed", {
      messages: [
        {
          ...fields,
          role: "user",
          userMessageId: "anchor",
          messageOrigin: "natural",
        },
      ],
    }),
  );
  await writer.commit(
    await prepare(journal, writer, "replace-operation", {
      turnReplacement: {
        command: {
          commandId: "replace",
          anchor: { turnScopeId: scope.turnScopeId },
          turnScopeId: "new-turn",
          newContent: "body🙂",
          attachments: [],
        },
        identity: {
          dialogProcessId: "new-dialog",
          messageUid: "new-message",
          userMessageId: "new-user",
        },
      },
    }),
  );
  const transactions = new PartitionTransactions(journal);
  await journal.usingSnapshot(async (snapshot) => {
    const original = await transactions.readEntityTransaction({
      snapshot,
      collection: "commands",
      key: "replace",
    });
    const cases = [
      [
        "missing receipt",
        (tx) => {
          tx.mutations = tx.mutations.filter((m) => m.collection !== "commands");
        },
      ],
      [
        "wrong command origin",
        (tx) => {
          tx.result.turnReplacementCommandId = "another";
        },
      ],
      [
        "missing suffix",
        (tx) => {
          delete tx.result.messageSuffix;
        },
      ],
      [
        "wrong count",
        (tx) => {
          tx.mutations.find((m) => m.collection === "metadata" && m.key === "messageCount").value +=
            1;
        },
      ],
      [
        "missing metadata",
        (tx) => {
          tx.mutations = tx.mutations.filter(
            (m) => !(m.collection === "metadata" && m.key === "session"),
          );
        },
      ],
      [
        "missing lifecycle header",
        (tx) => {
          tx.mutations = tx.mutations.filter(
            (m) => !(m.collection === "metadata" && m.key === "lifecycle"),
          );
        },
      ],
      [
        "missing body",
        (tx) => {
          tx.mutations = tx.mutations.filter((m) => m.collection !== "messageContent");
        },
      ],
      [
        "foreign replacement command",
        (tx) => {
          tx.mutations.find((m) => m.collection === "replacements").value.commandId = "another";
        },
      ],
      [
        "missing replacement tombstone",
        (tx) => {
          tx.mutations = tx.mutations.filter((m) => m.collection !== "replacements");
        },
      ],
      [
        "removed replacement tombstone",
        (tx) => {
          const m = tx.mutations.find((m) => m.collection === "replacements");
          delete m.value;
          m.remove = true;
        },
      ],
      [
        "duplicate suffix authority",
        (tx) => {
          tx.result.messageDeletionCommandId = "replace";
        },
      ],
    ];
    for (const [name, damage] of cases)
      await t.test(name, async () => {
        const source = structuredClone(original);
        damage(source.transaction);
        const reader = { readEntityTransaction: async () => source };
        await assert.rejects(
          readPartitionMutationProjection(
            reader,
            snapshot,
            { sessionId, parentSessionId: "" },
            "replace",
          ),
          { code: "SESSION_STORAGE_CORRUPT" },
        );
      });
  });
});
