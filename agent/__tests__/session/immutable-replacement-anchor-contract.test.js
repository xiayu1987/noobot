/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseTurnReplaceRequest } from "@noobot/session-protocol";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { upgradeImmutableMessageTailIndex } from "../../src/session/session-artifact-session/immutable-message-tail-index-upgrade.js";
import { IMMUTABLE_MESSAGE_TAIL_VERSION } from "../../src/session/session-artifact-session/immutable-message-tail-index.js";
import {
  immutableMutationFixture,
  mutationMessage as message,
} from "../helpers/immutable-mutation-integration-fixture.js";

const cases = [
  ["internal", { messageOrigin: "internal" }],
  ["injected", { injectedMessage: true, injectedBy: "harness", messageOrigin: undefined }],
  ["plugin", { pluginMessage: true, messageOrigin: undefined }],
];

function change() {
  return {
    turnReplacement: {
      command: parseTurnReplaceRequest({
        commandId: "replace",
        anchor: { turnScopeId: "continued" },
        turnScopeId: "replacement",
        newContent: "edited",
        attachments: [],
      }),
      identity: { dialogProcessId: "new-dialog", messageUid: "sm_new", userMessageId: "um_new" },
    },
  };
}

function records(fields, withNatural = true) {
  const answer = message("answer", "continued", {
    dialogProcessId: "d",
    role: "assistant",
    modelMessageId: "mm_answer",
    presentationMessageId: "pm_continued",
  });
  delete answer.userMessageId;
  delete answer.messageOrigin;
  const control = message("control", "control", { dialogProcessId: "d", ...fields });
  if (control.injectedMessage || control.pluginMessage) delete control.messageOrigin;
  return [
    message("keep"),
    ...(withNatural ? [message("user", "source", { dialogProcessId: "d" })] : []),
    control,
    answer,
  ];
}

function storeFor(f) {
  return new ImmutableSessionStore({ sessionDir: f.scope.sessionDir, sessionId: "s1" });
}

for (const [name, fields] of cases) {
  test(`replacement keeps the natural user anchor across ${name} user records`, async (t) => {
    const f = await immutableMutationFixture(t, { messages: records(fields) });
    const before = await f.open();
    const result = await f.commit(change());
    assert.deepEqual(
      result.result.turnReplacement.receipt.result.turnReplacement.replacedTurnScopeIds,
      ["source", "control", "continued"],
    );
    const reader = await f.open();
    assert.deepEqual(
      (await reader.exportSession()).messages.map((m) => m.content),
      ["keep", "edited"],
    );
    const replacement = (await reader.readMessage("sm_new")).message;
    assert.equal(replacement.messageOrigin, "natural");
    assert.notEqual(replacement.injectedMessage, true);
    assert.notEqual(replacement.pluginMessage, true);
    assert.notEqual(await before.readMessage("user"), null);
    assert.notEqual(await before.readMessage("control"), null);
  });

  test(`incremental ${name} user records preserve the natural anchor for a continued turn`, async (t) => {
    const all = records(fields);
    const f = await immutableMutationFixture(t, { messages: all.slice(0, 2) });
    const before = await f.open();
    await f.commit({ messages: all.slice(2) });
    const store = storeFor(f);
    const snapshot = await store.snapshot();
    for (const uid of ["control", "answer"])
      assert.equal((await store.get(snapshot, "messagePredecessors", uid)).userMessageUid, "user");
    assert.equal(await before.readMessage("control"), null);
    await f.commit(change());
    assert.deepEqual(
      (await (await f.open()).exportSession()).messages.map((m) => m.content),
      ["keep", "edited"],
    );
  });

  test(`replacement rejects a dialog with only ${name} user records without publication`, async (t) => {
    const f = await immutableMutationFixture(t, { messages: records(fields, false) });
    const store = storeFor(f);
    const before = await store.snapshot();
    await assert.rejects(f.commit(change()), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
    assert.deepEqual(await store.snapshot(), before);
    assert.equal(await (await f.open()).readCommand("replace"), null);
  });
}

for (const version of [1, 2]) {
  test(`offline upgrade rebuilds version ${version} anchors from the protocol and is idempotent`, async (t) => {
    const f = await immutableMutationFixture(t, { messages: records(cases[0][1]) });
    const store = storeFor(f);
    await store.commit({
      expectedGeneration: (await store.snapshot()).generation,
      operationId: "legacy-anchors",
      changes: [
        { collection: "metadata", key: "messageTailIndex", value: { version } },
        {
          collection: "messagePredecessors",
          key: "answer",
          value: {
            previousMessageUid: "control",
            userMessageUid: "control",
          },
        },
        {
          collection: "messagePredecessors",
          key: "control",
          value: {
            previousMessageUid: "user",
            userMessageUid: "control",
          },
        },
      ],
    });
    const before = await store.snapshot();
    await assert.rejects(f.commit(change()), { code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED" });
    assert.deepEqual(await store.snapshot(), before);
    const upgrade = () =>
      upgradeImmutableMessageTailIndex({ sessionDir: store.sessionDir, sessionId: "s1" });
    assert.equal((await upgrade()).result.upgraded, true);
    const after = await store.snapshot();
    assert.equal(after.generation, before.generation + 1);
    assert.deepEqual(await store.get(after, "metadata", "messageTailIndex"), {
      version: IMMUTABLE_MESSAGE_TAIL_VERSION,
    });
    for (const uid of ["control", "answer"])
      assert.equal((await store.get(after, "messagePredecessors", uid)).userMessageUid, "user");
    assert.equal(
      (await store.get(before, "messagePredecessors", "answer")).userMessageUid,
      "control",
    );
    assert.equal((await upgrade()).result.upgraded, false);
    assert.deepEqual(await store.snapshot(), after);
    await f.commit(change());
    assert.deepEqual(
      (await (await f.open()).exportSession()).messages.map((m) => m.content),
      ["keep", "edited"],
    );
  });
}

test("replacement rejects an internal record referenced by a corrupted current anchor index", async (t) => {
  const f = await immutableMutationFixture(t, { messages: records(cases[0][1]) });
  const store = storeFor(f);
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "corrupt-anchor",
    changes: [
      {
        collection: "messagePredecessors",
        key: "answer",
        value: {
          previousMessageUid: "control",
          userMessageUid: "control",
        },
      },
    ],
  });
  const before = await store.snapshot();
  await assert.rejects(f.commit(change()), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  assert.deepEqual(await store.snapshot(), before);
});
