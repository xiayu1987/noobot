/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ImapFlow } from "imapflow";
import { executeListEmail } from "../src/email/list-email.js";

const connectionInfo = {
  username: "test@example.com",
  password: "test-password",
  smtp_host: "smtp.example.com",
  imap_host: "imap.example.com",
};

function mailbox(context, { exists = 25, uids = [], messages = [], failure = null } = {}) {
  const calls = [];
  context.mock.method(ImapFlow.prototype, "connect", async function () {
    this.mailbox = { exists };
    calls.push("connect");
  });
  context.mock.method(ImapFlow.prototype, "getMailboxLock", async (folder) => {
    calls.push(["lock", folder]);
    return { release: () => calls.push("release") };
  });
  context.mock.method(ImapFlow.prototype, "logout", async () => calls.push("logout"));
  context.mock.method(ImapFlow.prototype, "search", async (...args) => {
    calls.push(["search", ...args]);
    return uids;
  });
  context.mock.method(ImapFlow.prototype, "fetch", async function* (...args) {
    calls.push(["fetch", ...args]);
    if (failure) throw failure;
    yield* messages;
  });
  return calls;
}

function message(uid, day) {
  return {
    uid,
    internalDate: `2026-07-${day}T00:00:00.000Z`,
    envelope: { subject: `message-${uid}`, from: [{ name: "Sender", address: "s@example.com" }] },
  };
}

test("email list pages by sequence and releases the mailbox before logout", async (context) => {
  const calls = mailbox(context, { messages: [message(12, "12"), message(15, "15")] });
  const result = await executeListEmail({ payload: { page: 2, page_size: 10 }, connectionInfo });
  assert.equal(result.total_count, 25);
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.messages.map(({ uid }) => uid),
    [15, 12],
  );
  assert.deepEqual(calls, [
    "connect",
    ["lock", "INBOX"],
    ["fetch", "6:15", { uid: true, envelope: true, internalDate: true }, undefined],
    "release",
    "logout",
  ]);
});

test("unseen email list uses UID search and fetch then pages the sorted summaries", async (context) => {
  const calls = mailbox(context, {
    uids: [3, 9, 12],
    messages: [message(3, "10"), message(12, "12"), message(9, "12")],
  });
  const result = await executeListEmail({
    payload: { folder: "Archive", unseen_only: true, page: 2, page_size: 2 },
    connectionInfo,
  });
  assert.equal(result.total_count, 3);
  assert.deepEqual(
    result.messages.map(({ uid }) => uid),
    [3],
  );
  assert.deepEqual(calls[2], ["search", { seen: false }, { uid: true }]);
  assert.deepEqual(calls[3], [
    "fetch",
    [3, 9, 12],
    { uid: true, envelope: true, internalDate: true },
    { uid: true },
  ]);
  assert.deepEqual(calls.slice(-2), ["release", "logout"]);
});

test("an empty mailbox does not fetch messages", async (context) => {
  const calls = mailbox(context, { exists: 0 });
  const result = await executeListEmail({ connectionInfo });
  assert.equal(result.total_count, 0);
  assert.deepEqual(result.messages, []);
  assert.deepEqual(calls, ["connect", ["lock", "INBOX"], "release", "logout"]);
});

test("a fetch failure propagates after the mailbox lock and connection are released", async (context) => {
  const failure = new Error("fetch failed");
  const calls = mailbox(context, { failure });
  await assert.rejects(executeListEmail({ connectionInfo }), (error) => error === failure);
  assert.deepEqual(calls.slice(-2), ["release", "logout"]);
});
