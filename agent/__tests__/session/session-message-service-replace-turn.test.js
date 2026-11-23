/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rename } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseTurnReplaceRequest } from "@noobot/session-protocol";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { forbidMutationBodyReads } from "./helpers/immutable-record-reads.js";
import {
  immutableMutationFixture,
  mutationMessage as message,
  mutationTime,
} from "../helpers/immutable-mutation-integration-fixture.js";

const replacement = (f, fields = {}) => ({
  ...f.request,
  anchor: { turnScopeId: "drop" },
  commandId: "replace-tail",
  turnScopeId: "replacement",
  newContent: "edited",
  attachments: [],
  ...fields,
});

function assistantMessage(uid, scope, fields = {}) {
  const result = message(uid, scope, {
    ...fields,
    role: "assistant",
    modelMessageId: `model-${uid}`,
    presentationMessageId: `presentation-${scope}`,
  });
  delete result.userMessageId;
  delete result.messageOrigin;
  return result;
}

test("replacement rejects invalid internal identities without publishing a head", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("drop")] });
  const before = await f.open();
  const command = parseTurnReplaceRequest({
    commandId: "invalid-identity",
    anchor: { turnScopeId: "drop" },
    newContent: "edited",
    turnScopeId: "replacement",
    attachments: [],
  });
  const identity = { dialogProcessId: "new-dialog", messageUid: "sm_new", userMessageId: "um_new" };
  await assert.rejects(
    f.commit({ turnReplacement: { command, identity: undefined } }),
    /require finite JSON values/,
  );
  assert.equal((await f.open()).generation, before.generation);
  for (const invalid of [
    {},
    { ...identity, userMessageId: " " },
    { ...identity, sessionId: "other" },
  ]) {
    await assert.rejects(
      f.commit({ turnReplacement: { command, identity: invalid } }),
      /requires canonical/,
    );
    assert.equal((await f.open()).generation, before.generation);
    assert.equal(await (await f.open()).readCommand(command.commandId), null);
  }
});

test("replacement command replays in a fresh process without publishing another head", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("drop")] });
  const first = await f.service.replaceTurn(replacement(f));
  const before = await f.open();
  const command = parseTurnReplaceRequest({
    commandId: "replace-tail",
    anchor: { turnScopeId: "drop" },
    newContent: "edited",
    turnScopeId: "replacement",
    attachments: [],
  });
  const moduleUrl = new URL("../helpers/commit-immutable-session-fixture.js", import.meta.url).href;
  const code = `import { commitSessionChanges } from ${JSON.stringify(moduleUrl)};
    const result = await commitSessionChanges(JSON.parse(process.argv[1]));
    process.stdout.write(JSON.stringify(result.result.turnReplacement));`;
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
    "--input-type=module",
    "--eval",
    code,
    JSON.stringify({
      sessionDir: f.scope.sessionDir,
      sessionId: "s1",
      expectedGeneration: before.generation,
      operationId: "fresh-process-retry",
      committedAt: mutationTime,
      changes: {
        turnReplacement: {
          command,
          identity: {
            dialogProcessId: "retry-dialog",
            messageUid: "sm_retry",
            userMessageId: "um_retry",
          },
        },
      },
    }),
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.deduplicated, true);
  assert.deepEqual(result.receipt.result.turnReplacement, first.turnReplacement);
  assert.equal((await f.open()).generation, before.generation);
});

test("replacement command changes retain the exact suffix and original user across later edits and retries", async (t) => {
  const f = await immutableMutationFixture(t, {
    messages: [
      message("keep", "keep", { dialogProcessId: "d" }),
      message("drop", "drop", { dialogProcessId: "d" }),
      message("keep-tail", "keep", { dialogProcessId: "d" }),
    ],
  });
  const command = parseTurnReplaceRequest({
    commandId: "replace-tail",
    anchor: { turnScopeId: "drop" },
    newContent: "edited",
    turnScopeId: "replacement",
    attachments: [],
  });
  const change = {
    turnReplacement: {
      command,
      identity: { dialogProcessId: "new-dialog", messageUid: "sm_new", userMessageId: "um_new" },
    },
  };
  const result = await f.commit(change);
  const before = await f.open();
  const delta = await before.readCommandChanges(command.commandId);
  const projection = await before.readMutationProjection(command.commandId);
  assert.equal(projection.baseAggregateVersion, 0);
  assert.deepEqual(projection.messageSuffix, { firstOrdinal: 2, previousMessageCount: 3 });
  assert.equal(projection.messages.length, 1);
  assert.equal(projection.messages[0].message.content, "edited");
  assert.equal(projection.messages[0].message.messageUid, "sm_new");
  assert.equal(projection.messages[0].ordinal, 2);
  assert.equal(delta.generation, result.generation);
  assert.equal(delta.kind, "commit");
  assert.deepEqual(delta.receipt, result.result.turnReplacement.receipt);
  assert.deepEqual(
    delta.changes
      .filter((entry) => entry.collection === "messages" && entry.remove)
      .map((entry) => entry.key),
    ["keep-tail", "drop"],
  );
  assert.equal(
    delta.changes.some(
      (entry) => entry.collection === "turns" && entry.key === "keep" && entry.remove,
    ),
    false,
  );
  const original = delta.changes.find(
    (entry) => entry.collection === "messages" && entry.key === "sm_new",
  ).value.message;
  assert.equal(original.content, "edited");
  await f.commit({ messages: [{ ...original, content: "later edit" }, message("later")] });
  const retried = await f.commit(change);
  assert.equal(retried.result.turnReplacement.deduplicated, true);
  const after = await f.open();
  assert.deepEqual(await after.readCommandChanges(command.commandId), delta);
  assert.deepEqual(await after.readMutationProjection(command.commandId), projection);
  assert.deepEqual(await before.readMutationProjection(command.commandId), projection);
  assert.deepEqual(await before.readCommandChanges(command.commandId), delta);
  assert.equal((await after.readMessage("sm_new")).message.content, "later edit");
  assert.notEqual(await after.readMessage("later"), null);
  assert.notEqual(await after.readMessage("keep"), null);
});

test("replaceTurn publishes fresh identities, suffix indexes and tombstones in one generation", async (t) => {
  const f = await immutableMutationFixture(t, {
    aggregateVersion: 2,
    messages: [message("keep"), message("drop", "drop", { error: "old failure" }), message("tail")],
  });
  const before = await f.open();
  t.mock.method(f.runtime.sessionCrudService, "getSessionDisplayData", () => {
    assert.fail("replacement response must not read the full display document");
  });
  const response = await f.service.replaceTurn(replacement(f, { expectedAggregateVersion: 2 }));
  assert.deepEqual(Object.keys(response).sort(), [
    "commandId",
    "committedAggregateVersion",
    "deduplicated",
    "displayMessages",
    "generation",
    "projection",
    "sessionId",
    "turnReplacement",
  ]);
  assert.equal(response.committedAggregateVersion, 3);
  assert.equal(response.projection.metadata.aggregateVersion, 3);
  assert.equal(response.displayMessages.length, 1);
  assert.equal(
    response.displayMessages[0].messageUid,
    response.turnReplacement.replacementUserMessageUid,
  );
  assert.equal(response.deduplicated, false);
  assert.deepEqual(response.projection.messageSuffix, { firstOrdinal: 2, previousMessageCount: 3 });
  const after = await f.open();
  assert.equal(after.generation, before.generation + 1);
  const session = await after.exportSession();
  assert.deepEqual(
    session.messages.map((item) => item.content),
    ["keep", "edited"],
  );
  const edited = session.messages[1];
  assert.match(edited.messageUid, /^sm_/);
  assert.match(edited.userMessageId, /^um_/);
  assert.equal(edited.error, undefined);
  assert.equal(edited.turnId, undefined);
  assert.equal(edited.turnScopeId, "replacement");
  assert.equal(edited.ts, mutationTime);
  assert.equal(edited.dialogProcessId, response.turnReplacement.replacementDialogProcessId);
  assert.equal(edited.messageUid, response.turnReplacement.replacementUserMessageUid);
  assert.deepEqual(response.turnReplacement.replacedTurnScopeIds, ["drop", "tail"]);
  assert.equal(session.turnLifecycle.sequence, 1);
  assert.deepEqual(Object.keys(session.turnLifecycle.replacedTurns).sort(), ["drop", "tail"]);
  assert.equal(await after.readMessage("drop"), null);
  assert.notEqual(await before.readMessage("drop"), null);
});

test("replaceTurn resolves a continued assistant turn to its committed dialog user anchor", async (t) => {
  const answer = message("answer", "continued", {
    role: "assistant",
    modelMessageId: "mm_continued",
    presentationMessageId: "p:continued",
    dialogProcessId: "dialog-source",
  });
  delete answer.userMessageId;
  delete answer.messageOrigin;
  const f = await immutableMutationFixture(t, {
    messages: [message("keep"), message("user", "source"), answer, message("tail")],
  });
  const result = await f.service.replaceTurn(
    replacement(f, { anchor: { turnScopeId: "continued" } }),
  );
  assert.deepEqual(result.turnReplacement.replacedTurnScopeIds, ["source", "continued", "tail"]);
  assert.deepEqual(
    (await (await f.open()).exportSession()).messages.map((item) => item.content),
    ["keep", "edited"],
  );
});

test("replaceTurn replays after anchor removal without advancing generation", async (t) => {
  const f = await immutableMutationFixture(t, {
    aggregateVersion: 2,
    messages: [message("keep"), message("drop")],
  });
  const request = replacement(f, { expectedAggregateVersion: 2 });
  const first = await f.service.replaceTurn(request);
  const committed = await f.open();
  const replay = await f.service.replaceTurn(request);
  assert.equal(replay.deduplicated, true);
  assert.deepEqual(replay.turnReplacement, first.turnReplacement);
  assert.equal((await f.open()).generation, committed.generation);
  for (const fields of [
    { newContent: "changed" },
    { anchor: { turnScopeId: "keep" } },
    { turnScopeId: "other" },
  ])
    await assert.rejects(f.service.replaceTurn({ ...request, ...fields }), {
      code: "SESSION_IDEMPOTENCY_KEY_REUSED",
    });
  assert.equal((await f.open()).generation, committed.generation);
});

test("replaceTurn rejects stale versions, missing anchors and reused identities without publication", async (t) => {
  const f = await immutableMutationFixture(t, {
    aggregateVersion: 5,
    messages: [message("keep"), message("drop")],
  });
  const before = await f.open();
  await assert.rejects(
    f.service.replaceTurn(replacement(f, { expectedAggregateVersion: 4 })),
    (error) => error.statusCode === 409 && error.currentVersion === 5,
  );
  await assert.rejects(
    f.service.replaceTurn(replacement(f, { anchor: { turnScopeId: "missing" } })),
    (error) => error.statusCode === 404,
  );
  await assert.rejects(f.service.replaceTurn(replacement(f, { turnScopeId: "keep" })), /fresh/);
  assert.equal((await f.open()).generation, before.generation);
});

test("replaceTurn validates required payload and rejects compatibility or ambiguous anchors", async (t) => {
  const f = await immutableMutationFixture(t);
  t.mock.method(f.repository, "requireSessionReader", () =>
    assert.fail("invalid request accessed storage"),
  );
  for (const fields of [
    { newContent: " " },
    { turnScopeId: "" },
    { commandId: "" },
    { attachments: undefined },
    { anchor: {} },
    { anchor: { ts: mutationTime } },
    { anchor: { dialogId: "legacy" } },
    { anchor: { turnScopeId: "drop", messageUid: "ambiguous" } },
  ])
    await assert.rejects(f.service.replaceTurn(replacement(f, fields)));
});

test("replacement protocol rejects unknown fields and noncanonical values", () => {
  const request = {
    commandId: "c",
    anchor: { turnScopeId: "t" },
    newContent: "edited",
    turnScopeId: "new",
    attachments: [],
  };
  assert.equal(parseTurnReplaceRequest(request).turnScopeId, "new");
  for (const fields of [
    { extra: true },
    { newContent: " edited" },
    { attachments: [null] },
    { expectedAggregateVersion: -1 },
  ])
    assert.throws(() => parseTurnReplaceRequest({ ...request, ...fields }));
});

test("replaceTurn persists incoming canonical attachments and rejects missing stable identity", async (t) => {
  const attachment = {
    attachmentId: "att-1",
    sessionId: "s1",
    attachmentSource: "user",
    name: "report.txt",
    mimeType: "text/plain",
    size: 123,
  };
  const f = await immutableMutationFixture(t, {
    messages: [
      message("drop", "drop", { attachments: [{ ...attachment, path: "/old/report.txt" }] }),
    ],
  });
  const before = await f.open();
  await assert.rejects(
    f.service.replaceTurn(replacement(f, { attachments: [{ name: "no identity" }] })),
    /invalid_attachment_id/,
  );
  assert.equal((await f.open()).generation, before.generation);
  const result = await f.service.replaceTurn(replacement(f, { attachments: [attachment] }));
  assert.deepEqual(
    (await (await f.open()).readMessage(result.turnReplacement.replacementUserMessageUid)).message
      .attachments,
    [attachment],
  );
});

test("replaceTurn leaves another session graph unchanged", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("drop")] });
  const other = await immutableMutationFixture(t, { messages: [message("other")] });
  const before = await other.open();
  await f.service.replaceTurn(replacement(f));
  assert.deepEqual(await (await other.open()).exportSession(), await before.exportSession());
});

async function complete(f, scope) {
  for (const event of [
    {
      eventType: "turn.action_accepted",
      phase: "action",
      action: "send",
      dialogProcessId: `dialog-${scope}`,
      presentationMessageId: `p:${scope}`,
      executionId: `agent:${scope}`,
      executionKind: "agent",
      rootExecutionId: `agent:${scope}`,
    },
    { eventType: "turn.processing_started", phase: "processing" },
    {
      eventType: "turn.processing_completed",
      phase: "completion",
      completionCommitId: `completed:${scope}`,
    },
    {
      eventType: "turn.completed",
      phase: "completion",
      terminalStatus: { command: "completed" },
      commandId: `completed:${scope}`,
    },
  ])
    await f.commit({
      turnTransition: {
        sessionId: "s1",
        turnScopeId: scope,
        commandId: `${event.eventType}:${scope}`,
        causationId: `${event.eventType}:${scope}`,
        ...event,
      },
    });
}

test("replaceTurn atomically removes related lifecycle, summaries, timings, commands and outbox", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("keep"), message("drop")] });
  for (const scope of ["keep", "drop"]) {
    await complete(f, scope);
    await f.commit({
      timings: [{ turnScopeId: scope, dialogProcessId: `dialog-${scope}`, modelLoopRound: 1 }],
      summaryCheckpoints: [
        {
          userId: "u1",
          sessionId: "s1",
          dialogProcessId: `dialog-${scope}`,
          turnScopeId: scope,
          checkpointId: `cp:${scope}`,
          expectedCheckpointRevision: 0,
          persistedMessageUids: [],
          summarizedMessageUids: [scope],
          retainedMessageUids: [],
          messages: [],
        },
      ],
    });
  }
  const before = await f.open();
  assert.notEqual(await before.readCheckpoint("drop", "cp:drop"), null);
  const result = await f.service.replaceTurn(replacement(f));
  const after = await f.open();
  assert.equal(after.generation, before.generation + 1);
  assert.notEqual(await after.readTurnState("keep"), null);
  assert.equal(await after.readTurnState("drop"), null);
  assert.equal(await after.readTurnTiming("drop"), null);
  assert.equal(await after.readCommand("turn.action_accepted:drop"), null);
  assert.equal(await after.readCheckpoint("drop", "cp:drop"), null);
  assert.equal(await after.readCheckpointState("drop"), null);
  assert.notEqual(await after.readCheckpoint("keep", "cp:keep"), null);
  assert.notEqual(await before.readCheckpoint("drop", "cp:drop"), null);
  assert.equal((await after.readOutboxPage({ consumerId: "client" })).events.length, 4);
  assert.equal((await before.readOutboxPage({ consumerId: "client" })).events.length, 8);
  const session = await after.exportSession();
  assert.equal(session.turnLifecycle.replacedTurns.drop.replacementTurnScopeId, "replacement");
  assert.deepEqual(
    (await after.readCommand("replace-tail")).result.turnReplacement,
    result.turnReplacement,
  );
});

test("replaceTurn head publication failure retains the old graph and retries the command", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("keep"), message("drop")] });
  await complete(f, "drop");
  const before = await f.open();
  setFsAdapter({
    rename: async (source, target) => {
      if (target === `${f.scope.sessionDir}/head.json`)
        throw Object.assign(new Error("injected"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(f.service.replaceTurn(replacement(f)), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  const failed = await f.open();
  assert.equal(failed.generation, before.generation);
  assert.deepEqual(await failed.exportSession(), await before.exportSession());
  assert.equal(await failed.readCommand("replace-tail"), null);
  assert.equal((await failed.readOutboxPage({ consumerId: "client" })).events.length, 4);
  await f.service.replaceTurn(replacement(f));
  assert.equal(await (await f.open()).readMessage("drop"), null);
});

test("replacement of a later user in one dialog preserves the earlier user and response", async (t) => {
  const dialogProcessId = "shared-dialog";
  const f = await immutableMutationFixture(t, {
    messages: [
      message("first", "first", { dialogProcessId }),
      assistantMessage("answer", "first", { dialogProcessId }),
      message("drop", "drop", { dialogProcessId }),
      assistantMessage("tail", "drop", { dialogProcessId }),
    ],
  });
  await f.service.replaceTurn(replacement(f));
  assert.deepEqual(
    (await (await f.open()).exportSession()).messages.map((item) => item.content),
    ["first", "answer", "edited"],
  );
});

test("replacement of a continuation uses its nearest user interjection", async (t) => {
  const dialogProcessId = "shared-dialog";
  const f = await immutableMutationFixture(t, {
    messages: [
      message("first", "first", { dialogProcessId }),
      assistantMessage("answer", "first", { dialogProcessId }),
      message("interjection", "interjection", { dialogProcessId }),
      assistantMessage("drop", "drop", { dialogProcessId }),
    ],
  });
  await f.service.replaceTurn(replacement(f));
  assert.deepEqual(
    (await (await f.open()).exportSession()).messages.map((item) => item.content),
    ["first", "answer", "edited"],
  );
});

test("committed message role changes reject before publishing a head", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("drop")] });
  const before = await f.open();
  await assert.rejects(f.commit({ messages: [assistantMessage("drop", "drop")] }), {
    code: "SESSION_MESSAGE_IDENTITY_CONFLICT",
  });
  assert.equal((await f.open()).generation, before.generation);
  assert.equal((await (await f.open()).readMessage("drop")).message.role, "user");
});

test("replacement of the first turn updates the title and permits a subsequent append", async (t) => {
  const f = await immutableMutationFixture(t, { messages: [message("drop")] });
  await f.service.replaceTurn(replacement(f));
  assert.equal(
    (await (await f.open()).readMetadata({ includeAutoTitle: true })).autoTitle,
    "edited",
  );
  await f.commit({ messages: [message("next")] });
  assert.deepEqual(
    (await (await f.open()).exportSession()).messages.map((item) => item.content),
    ["edited", "next"],
  );
});

test("replacing the tail reads only the retained title prefix and no removed body", async (t) => {
  const title = "12345678901234567890";
  const f = await immutableMutationFixture(t, {
    messages: [
      message("keep", "keep", { content: title + "body".repeat(50000) }),
      message("drop", "drop", { content: "removed ".repeat(25000) }),
    ],
  });
  const store = await ImmutableSessionStore.open({ sessionDir: f.scope.sessionDir });
  setFsAdapter(await forbidMutationBodyReads(store, "keep", "drop"));
  try {
    await f.service.replaceTurn(replacement(f));
    const reader = await f.open();
    assert.equal((await reader.readMetadata({ includeAutoTitle: true })).autoTitle, title);
    assert.equal(await reader.readMessage("drop"), null);
  } finally {
    resetFsAdapter();
  }
});

test("reused user identity accepts integrity fields and ignores derived presentation without writing", async (t) => {
  const attachment = {
    attachmentId: "att-1",
    sessionId: "s1",
    attachmentSource: "user",
    path: "/runtime/a.txt",
    contentSha256: "sha-1",
    name: "original.txt",
    mimeType: "text/plain",
  };
  const f = await immutableMutationFixture(t, {
    messages: [message("user", "edited", { attachments: [attachment] })],
  });
  const before = await f.open();
  for (const attachments of [
    [attachment],
    [{ ...attachment, name: "derived.txt", downloadUrl: "/download" }],
  ]) {
    const result = await f.service.assertReusedUserTurnIdentity({
      ...f.request,
      turnScopeId: "edited",
      dialogProcessId: "dialog-edited",
      attachments,
    });
    assert.equal(result.asserted, true);
    assert.deepEqual(result.userMessage.attachments, [attachment]);
  }
  assert.equal((await f.open()).generation, before.generation);
});

test("reused user identity rejects immutable attachment and dialog divergence", async (t) => {
  const attachment = {
    attachmentId: "att-1",
    sessionId: "s1",
    attachmentSource: "user",
    path: "/runtime/a.txt",
    contentSha256: "sha-1",
    name: "original.txt",
    mimeType: "text/plain",
  };
  const f = await immutableMutationFixture(t, {
    messages: [message("user", "edited", { attachments: [attachment] })],
  });
  const request = {
    ...f.request,
    turnScopeId: "edited",
    dialogProcessId: "dialog-edited",
    attachments: [attachment],
  };
  const before = await f.open();
  for (const fields of [
    { attachmentId: "att-2" },
    { sessionId: "s2" },
    { attachmentSource: "model" },
    { path: "/other" },
    { contentSha256: "sha-2" },
  ])
    await assert.rejects(
      f.service.assertReusedUserTurnIdentity({
        ...request,
        attachments: [{ ...attachment, ...fields }],
      }),
      (error) =>
        error.code === "INVALID_CANONICAL_ATTACHMENT" ||
        /attachments do not match Session authority/.test(error.message),
    );
  await assert.rejects(
    f.service.assertReusedUserTurnIdentity({ ...request, dialogProcessId: "other" }),
    /dialogProcessId does not match/,
  );
  await assert.rejects(
    f.service.assertReusedUserTurnIdentity({ ...request, turnScopeId: "" }),
    /turnScopeId is required/,
  );
  assert.equal((await f.open()).generation, before.generation);
});
