/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { forbidRecordReads, readCommittedPage } from "./helpers/immutable-record-reads.js";

const ts = "2026-01-01T00:00:00.000Z";

async function fixture(t, content) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "content-append-boundaries-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "append-boundaries",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  const store = await ImmutableSessionStore.open({ sessionDir });
  const outcome = await commitSessionChanges({
    sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "seed",
    committedAt: ts,
    changes: {
      messages: [
        {
          messageUid: "message",
          userMessageId: "user-message",
          sessionId: store.sessionId,
          parentSessionId: "",
          dialogProcessId: "dialog",
          parentDialogProcessId: "",
          turnScopeId: "turn",
          role: "user",
          messageOrigin: "natural",
          type: "message",
          content,
          attachments: [],
          transferEnvelopes: [],
          ts,
        },
      ],
    },
  });
  return { store, receipt: outcome.result.messageReceipts[0] };
}

function request(store, receipt, content, operationId) {
  return {
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: receipt.generation,
    operationId,
    committedAt: ts,
    changes: {
      messageContentAppends: [
        {
          messageUid: receipt.messageUid,
          dialogProcessId: receipt.dialogProcessId,
          turnScopeId: receipt.turnScopeId,
          expectedContentReference: receipt.contentReference,
          content,
        },
      ],
    },
  };
}

test("cold sequential appends use receipt versions and preserve split surrogate and escape boundaries", async (t) => {
  const { store, receipt: initial } = await fixture(t, "");
  let receipt = initial;
  let expected = "";
  let firstRequest;
  let firstReceipt;
  for (const [index, fragment] of [
    "\ud83d",
    "\ude00",
    '\0\t\r\n"\\',
    "中文",
    "\udc00",
    "\ud800",
  ].entries()) {
    const options = request(store, receipt, fragment, `fragment-${index}`);
    const result = await commitSessionChanges(options);
    receipt = result.result.messageReceipts[0];
    expected += fragment;
    assert.equal(receipt.generation, options.expectedGeneration + 1);
    assert.notEqual(
      receipt.contentReference,
      options.changes.messageContentAppends[0].expectedContentReference,
    );
    const cold = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
    assert.equal(
      (await cold.get(await cold.snapshot(), "messages", "message")).message.content,
      expected,
    );
    if (index === 0) {
      firstRequest = options;
      firstReceipt = receipt;
    }
  }
  const replay = await commitSessionChanges(firstRequest);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result.messageReceipts, [firstReceipt]);
  assert.equal((await store.snapshot()).generation, receipt.generation);
  await assert.rejects(
    commitSessionChanges({
      ...request(store, firstReceipt, "stale", "stale-version"),
      expectedGeneration: receipt.generation,
    }),
    { code: "SESSION_MESSAGE_CONTENT_VERSION_CONFLICT" },
  );
  assert.equal(
    (await store.get(await store.snapshot(), "messages", "message")).message.content,
    expected,
  );
});

async function payloads(store, reference, result = []) {
  const page = await readCommittedPage(store, reference);
  if (page.kind === "value-branch") {
    await payloads(store, page.left, result);
    await payloads(store, page.right, result);
  } else if (page.kind === "value") result.push(page.data);
  else assert.equal(page.kind, "value-inline");
  return result;
}

test("cold append retains earlier body payloads without reading them", async (t) => {
  const content = randomBytes(512 * 1024).toString("base64");
  const { store, receipt } = await fixture(t, content);
  const records = await payloads(store, receipt.contentReference);
  assert.ok(records.length > 2, "fixture must span several body blocks");
  setFsAdapter(await forbidRecordReads(store, records.slice(0, -1)));
  let observed;
  try {
    observed = await observeSessionStorageWork(() =>
      commitSessionChanges(request(store, receipt, "🙂\n", "cold-append")),
    );
  } finally {
    resetFsAdapter();
  }
  assert.ok(observed.work.immutableWriteBytes < 65536, JSON.stringify(observed.work));
  assert.equal(
    (await store.get(await store.snapshot(), "messages", "message")).message.content,
    content + "🙂\n",
  );
});

async function verifyPublicationRetry(t, published) {
  const { store, receipt } = await fixture(t, "before");
  const options = request(store, receipt, " after", "retry-append");
  const before = await readFile(store.headPath);
  const injected = Object.assign(new Error("injected append publication failure"), { code: "EIO" });
  setFsAdapter({
    rename: async (from, to) => {
      if (String(to) === store.headPath) {
        if (published) await rename(from, to);
        throw injected;
      }
      return rename(from, to);
    },
  });
  try {
    await assert.rejects(
      commitSessionChanges(options),
      (error) =>
        error.code === "SESSION_COMMIT_UNCERTAIN" &&
        error.operationId === options.operationId &&
        error.cause === injected,
    );
  } finally {
    resetFsAdapter();
  }
  if (published) assert.notDeepEqual(await readFile(store.headPath), before);
  else assert.deepEqual(await readFile(store.headPath), before);
  assert.equal(
    (await store.get(await store.snapshot(), "messages", "message")).message.content,
    published ? "before after" : "before",
  );
  const committed = await commitSessionChanges(options);
  assert.equal(committed.replayed, published);
  assert.equal(committed.generation, receipt.generation + 1);
  const replayed = await commitSessionChanges(options);
  assert.deepEqual(replayed.result.messageReceipts, committed.result.messageReceipts);
  assert.equal(replayed.replayed, true);
  assert.equal(
    (await store.get(await store.snapshot(), "messages", "message")).message.content,
    "before after",
  );
}

for (const published of [false, true]) {
  test(`uncertain append retries exactly once when the head was ${published ? "published" : "not published"}`, (t) =>
    verifyPublicationRetry(t, published));
}
