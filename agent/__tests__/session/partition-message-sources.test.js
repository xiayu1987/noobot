/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { openPartitionSessionReader } from "../../src/session/partition-storage/partition-session-reader.js";
import { getSessionMessageSources } from "../../src/session/services/session-message-service/message-queries.js";
import {
  createMessageCase,
  message,
  openTestMessages,
  prepare,
  scope,
} from "./partition-session-messages.test-helpers.js";

test("business message sources read ordered partition bodies across append, pinned readers and restart replay", async (t) => {
  const { journal, sessionId, root } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const first = { ...message(sessionId, "m1"), content: '首条🙂\n"' };
  const second = message(sessionId, "m2");
  const created = await messages.commit(
    await prepare(journal, messages, "create", { messages: [first, second] }),
  );
  const options = { journal, sessionId, parentSessionId: "" };
  const selection = { messageUids: ["m2", "m1"] };
  const [{ owner, contentReference }] = created.result.messageReceipts;
  const request = await prepare(journal, messages, "append", {
    messageContentAppends: [
      {
        ...scope,
        messageUid: "m1",
        owner,
        expectedContentReference: contentReference,
        content: "追加\\tail",
      },
    ],
  });
  let result;
  {
    await using reader = await openPartitionSessionReader(options);
    const records = await reader.readMessages(selection);
    assert.deepEqual(
      records.map(({ ordinal }) => ordinal),
      [2, 1],
    );
    assert.deepEqual(
      records.map(({ message }) => message.content),
      [second.content, first.content],
    );
    assert.deepEqual(await reader.readMessages({ messageUids: ["absent", "m2"] }), [
      null,
      records[0],
    ]);
    assert.deepEqual(await reader.readMessages({ messageUids: [] }), []);
    result = await messages.commit(request);
    assert.deepEqual(await reader.readMessages(selection), records);
  }
  const readSources = (journal) =>
    getSessionMessageSources.call(
      {
        sessionRepo: {
          requireSessionReader: async (userId, requestedSessionId) => {
            assert.equal(userId, "fixture-user");
            assert.equal(requestedSessionId, sessionId);
            return openPartitionSessionReader({ ...options, journal });
          },
        },
      },
      { userId: "fixture-user", sessionId, ...selection, turnScopeIds: [scope.turnScopeId] },
    );
  const sources = await readSources(journal);
  assert.deepEqual(
    sources.map(({ content }) => content),
    [second.content, first.content + "追加\\tail"],
  );
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const restored = openTestMessages(reopened, sessionId);
  assert.deepEqual(await restored.commit(request), { ...result, replayed: true });
  assert.deepEqual(await readSources(reopened), sources);
});

test("batch materialization shares one byte budget and validates the canonical selection", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  await messages.commit(
    await prepare(journal, messages, "create", {
      messages: [{ ...message(sessionId, "m1"), content: '首条🙂\n"\\' }, message(sessionId, "m2")],
    }),
  );
  await using reader = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  const [record] = await reader.readMessages({ messageUids: ["m1"] });
  const { content, ...metadata } = record.message;
  const { ordinal, turnOrdinal } = record;
  const used =
    Buffer.byteLength(JSON.stringify(metadata)) +
    Buffer.byteLength(JSON.stringify({ ordinal, turnOrdinal }));
  const requested = Buffer.byteLength(JSON.stringify(content));
  const maxBytes = used + requested;
  assert.deepEqual(await reader.readMessages({ messageUids: ["m1"], maxBytes }), [record]);
  await assert.rejects(reader.readMessages({ messageUids: ["m1"], maxBytes: maxBytes - 1 }), {
    code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
    limit: maxBytes - 1,
    used,
    requested,
  });
  await assert.rejects(reader.readMessages({ messageUids: ["m1", "m2"], maxBytes }), {
    code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
  });
  for (const messageUids of [["m1", "m1"], [" m1"], [""]])
    await assert.rejects(reader.readMessages({ messageUids }), TypeError);
  assert.deepEqual(await reader.readMessages({ messageUids: ["m1"] }), [record]);
});

test("deleted suffix messages stay absent after position reuse while the old reader retains bodies", async (t) => {
  const { journal, sessionId } = await createMessageCase(t);
  const messages = openTestMessages(journal, sessionId);
  const other = { dialogProcessId: "other-dialog", turnScopeId: "other-turn" };
  for (const entry of [
    message(sessionId, "retained"),
    { ...message(sessionId, "anchor"), ...other },
    message(sessionId, "removed"),
  ])
    await messages.commit(
      await prepare(journal, messages, `create-${entry.messageUid}`, { messages: [entry] }),
    );
  await using old = await openPartitionSessionReader({ journal, sessionId, parentSessionId: "" });
  await messages.commit(
    await prepare(journal, messages, "delete", {
      messageDeletion: { commandId: "delete", anchor: { turnScopeId: other.turnScopeId } },
    }),
  );
  await messages.commit(
    await prepare(journal, messages, "reuse-position", {
      messages: [message(sessionId, "new")],
    }),
  );
  await using current = await openPartitionSessionReader({
    journal,
    sessionId,
    parentSessionId: "",
  });
  const messageUids = ["removed", "anchor", "new", "retained"];
  assert.deepEqual(
    (await current.readMessages({ messageUids })).map(
      (record) => record?.message.messageUid ?? null,
    ),
    [null, null, "new", "retained"],
  );
  assert.deepEqual(
    (await old.readMessages({ messageUids })).map((record) => record?.message.messageUid ?? null),
    ["removed", "anchor", null, "retained"],
  );
});
