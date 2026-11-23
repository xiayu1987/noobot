/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  persistSessionDeletionMarkers,
  submitTestSessionRequest,
} from "../helpers/session-services.js";
import assert from "node:assert/strict";
import test from "node:test";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeSessionPageSnapshotCursor } from "@noobot/session-protocol/message-read-budget";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  registerImmutableContextRepositoryTests,
  registerImmutableLifecycleRepositoryTests,
} from "../helpers/immutable-repository-cases.js";
import { registerImmutableAttachmentRepositoryTests } from "../helpers/immutable-repository-attachment-cases.js";
import { registerImmutableTurnIdentityTests } from "../helpers/immutable-repository-turn-identity-cases.js";
import { ts, message, fixture } from "./immutable-session-repository.test-helpers.js";

registerImmutableTurnIdentityTests({ fixture, message, ts });

registerImmutableAttachmentRepositoryTests({ fixture, message, ts });

test("display reads use immutable authority without reading legacy artifacts", async (t) => {
  const { repository, scope, persistenceContext } = await fixture(t);
  const reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  await submitTestSessionRequest(
    repository,
    "u1",
    "s1",
    await reader.prepareRequest({
      operationId: "seed-display",
      committedAt: ts,
      changes: { messages: [message("display-message")] },
    }),
    persistenceContext,
  );
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  await writeFile(path.join(scope.sessionDir, "session-summary.json"), "invalid legacy cache");
  const direct = await repository.readSessionDisplaySummary("u1", "s1", { persistenceContext });
  assert.equal(direct.messages[0].content, "display-message");
  await writeFile(path.join(scope.sessionDir, "head.json"), "invalid immutable head");
  await assert.rejects(repository.readSessionDisplaySummary("u1", "s1", { persistenceContext }));
});

test("repository delta commit and pinned queries work without a readable legacy manifest", async (t) => {
  const { repository, persistenceContext, scope } = await fixture(t);
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  const before = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const command = {
    operationId: "append",
    changes: { messages: [message("m1")] },
    committedAt: ts,
  };
  const submit = (request) =>
    submitTestSessionRequest(repository, "u1", "s1", request, persistenceContext);
  const request = await before.prepareRequest(command);
  const committed = await submit(request);
  assert.equal(committed.generation, before.generation + 1);
  assert.equal((await submit(request)).replayed, true);
  assert.equal(await before.readMessage("m1"), null);
  const current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.equal((await current.readMessage("m1")).message.content, "m1");
  assert.equal((await current.readFacts()).messageCount, 1);
  assert.equal((await current.readTurnPage({ turnScopeId: "t1" })).records.length, 1);
  assert.equal((await current.exportSession()).messages.length, 1);
  await assert.rejects(submit(await before.prepareRequest({ ...command, operationId: "stale" })), {
    code: "SESSION_GENERATION_CONFLICT",
  });
});

test("reader captures changes before submission waits for session scope", async (t) => {
  const { repository, persistenceContext } = await fixture(t);
  await using reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const command = {
    operationId: "capture-before-scope",
    changes: { messages: [message("m1")] },
    committedAt: ts,
  };
  const pending = submitTestSessionRequest(
    repository,
    "u1",
    "s1",
    await reader.prepareRequest(command),
    persistenceContext,
  );
  command.changes.messages[0].content = "changed while waiting";
  await pending;
  await using current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.equal((await current.readMessage("m1")).message.content, "m1");
});

test("registered sessions require their head even without a format marker", async (t) => {
  const { runtime, repository, persistenceContext, scope } = await fixture(t);
  const query = { userId: "u1", sessionId: "s1", persistenceContext };
  const sources = () =>
    runtime.sessionMessageService.getSessionMessageSources({
      ...query,
      turnScopeIds: ["t1"],
      messageUids: ["m1"],
    });
  const checkpoint = () =>
    runtime.sessionMessageService.getTurnSummaryCheckpointState({
      ...query,
      turnScopeId: "t1",
      dialogProcessId: "d1",
    });
  await rm(path.join(scope.sessionDir, "immutable-session.format"), { force: true });
  await rm(path.join(scope.sessionDir, "head.json"));
  for (const read of [
    () => repository.findSessionReader("u1", "s1", { persistenceContext }),
    () => repository.findTurnTerminalSource("u1", "s1", { persistenceContext, turnScopeId: "t1" }),
    sources,
    checkpoint,
  ]) {
    await assert.rejects(read(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  }
  await persistSessionDeletionMarkers(repository, "u1", ["s1"]);
  await assert.rejects(sources(), { code: "SESSION_DELETED" });
  await assert.rejects(checkpoint(), { code: "SESSION_DELETED" });
});

test("required message queries reject an unregistered session", async (t) => {
  const { runtime, repository, persistenceContext } = await fixture(t);
  t.mock.method(repository, "locateSessionScope", async () => null);
  assert.equal(await repository.findSessionReader("u1", "absent", { persistenceContext }), null);
  const query = { userId: "u1", sessionId: "absent", persistenceContext };
  await assert.rejects(
    runtime.sessionMessageService.getSessionMessageSources({
      ...query,
      turnScopeIds: ["t1"],
      messageUids: ["m1"],
    }),
    { code: "SESSION_NOT_FOUND" },
  );
  await assert.rejects(
    runtime.sessionMessageService.getTurnSummaryCheckpointState({
      ...query,
      turnScopeId: "t1",
      dialogProcessId: "d1",
    }),
    { code: "SESSION_NOT_FOUND" },
  );
});

test("repository rejects deleted sessions and does not fall back when an immutable head is missing", async (t) => {
  const { repository, persistenceContext, scope } = await fixture(t);
  await rm(path.join(scope.sessionDir, "head.json"));
  await assert.rejects(repository.findSessionReader("u1", "s1", { persistenceContext }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(repository.requireSessionReader("u1", "s1", { persistenceContext }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await persistSessionDeletionMarkers(repository, "u1", ["s1"]);
  assert.equal(await repository.findSessionReader("u1", "s1", { persistenceContext }), null);
  assert.equal(
    await repository.findTurnLifecycleSource("u1", "s1", { persistenceContext, terminalLimit: 1 }),
    null,
  );
  await assert.rejects(repository.requireSessionReader("u1", "s1", { persistenceContext }), {
    code: "SESSION_DELETED",
  });
  await assert.rejects(
    repository.withSessionReader(
      "u1",
      "s1",
      async ({ reader, commitChanges }) =>
        commitChanges(
          await reader.prepareRequest({
            operationId: "revive",
            changes: { messages: [message("m1")] },
            committedAt: ts,
          }),
        ),
      { persistenceContext },
    ),
    { code: "SESSION_DELETED" },
  );
});

test("scoped turn pages preserve snapshots, dialog ownership and read budgets", async (t) => {
  const { repository, persistenceContext, scope } = await fixture(t);
  const initial = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  await submitTestSessionRequest(
    repository,
    "u1",
    "s1",
    await initial.prepareRequest({
      operationId: "selected-view",
      committedAt: ts,
      changes: {
        messages: [
          message("m1"),
          message("m2"),
          { ...message("old1"), dialogProcessId: "old", turnScopeId: "history" },
          { ...message("old2"), dialogProcessId: "old", turnScopeId: "history" },
        ],
      },
    }),
    persistenceContext,
  );
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  await using pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const query = { lookupKey: { turnScopeId: "t1", dialogProcessId: "d1" }, cursor: null, limit: 1 };
  const first = await pinned.readScopedTurnMessagePage(query);
  assert.equal(first.generation, pinned.generation);
  assert.equal(first.messageCount, 2);
  assert.deepEqual(
    first.records.map(({ message }) => message.messageUid),
    ["m1"],
  );
  assert.ok(first.nextCursor);
  await assert.rejects(pinned.readScopedTurnMessagePage({ ...query, maxBytes: 1 }), {
    code: "SESSION_MESSAGE_READ_BUDGET_EXCEEDED",
  });
  const foreign = { ...query, lookupKey: { turnScopeId: "t1", dialogProcessId: "wrong" } };
  assert.equal(await pinned.readScopedTurnMessagePage(foreign), null);
  await assert.rejects(pinned.readScopedTurnMessagePage({ ...foreign, cursor: first.nextCursor }), {
    code: "SESSION_PAGE_CURSOR_CONFLICT",
  });
  const detailQuery = {
    persistenceContext,
    lookupKey: { turnScopeId: "t1", dialogProcessId: "d1" },
    cursor: null,
    limit: 1,
  };
  const detail = await repository.readSessionThinkingDetail("u1", "s1", detailQuery);
  assert.equal(detail.exists, true);
  assert.equal(detail.messages[0].turnScopeId, "t1");
  assert.equal(detail.generation, pinned.generation);
  const detailPage = await pinned.readThinkingDetailPage(detailQuery);
  assert.deepEqual(
    detailPage.records.map(({ message }) => message),
    detail.messages,
  );
  assert.deepEqual(
    decodeSessionPageSnapshotCursor(detail.nextCursor).cursor,
    detailPage.nextCursor,
  );
  const continueDetail = (lookupKey = detailQuery.lookupKey) =>
    repository.readSessionThinkingDetail("u1", "s1", {
      ...detailQuery,
      lookupKey,
      cursor: detail.nextCursor,
    });
  await assert.rejects(continueDetail(foreign.lookupKey), {
    code: "SESSION_PAGE_SNAPSHOT_EXPIRED",
  });
  assert.deepEqual(
    await repository.readSessionThinkingDetail("u1", "s1", {
      ...detailQuery,
      lookupKey: { turnScopeId: "t1", dialogProcessId: "wrong" },
    }),
    { exists: false },
  );
  await submitTestSessionRequest(
    repository,
    "u1",
    "s1",
    await pinned.prepareRequest({
      operationId: "update-selected",
      committedAt: ts,
      changes: { messages: [{ ...message("m1"), content: "changed" }, message("m3")] },
    }),
    persistenceContext,
  );
  assert.equal((await pinned.readScopedTurnMessagePage(query)).records[0].message.content, "m1");
  const second = await pinned.readScopedTurnMessagePage({ ...query, cursor: first.nextCursor });
  assert.deepEqual(
    second.records.map(({ message }) => message.messageUid),
    ["m2"],
  );
  assert.equal(second.nextCursor, null);
  const continuedDetail = await continueDetail();
  assert.equal(continuedDetail.generation, detail.generation);
  assert.deepEqual(
    continuedDetail.messages.map(({ messageUid }) => messageUid),
    ["m2"],
  );
  assert.equal(continuedDetail.nextCursor, null);
  await assert.rejects(continueDetail(), { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" });
  const updatedDetail = await repository.readSessionThinkingDetail("u1", "s1", detailQuery);
  assert.notEqual(updatedDetail.generation, detail.generation);
  assert.equal(updatedDetail.messages[0].messageUid, "m1");
  assert.equal(updatedDetail.messages[0].content, null);
  await using current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.equal(
    (await current.readScopedTurnMessagePage(query)).records[0].message.content,
    "changed",
  );
  await assert.rejects(current.readScopedTurnMessagePage({ ...query, cursor: first.nextCursor }), {
    code: "SESSION_PAGE_CURSOR_CONFLICT",
  });
  await persistSessionDeletionMarkers(repository, "u1", ["s1"]);
  await assert.rejects(repository.requireSessionReader("u1", "s1", { persistenceContext }), {
    code: "SESSION_DELETED",
  });
});

test("metadata settings and user meta stay on the immutable authority after migration", async (t) => {
  const { runtime, repository, persistenceContext, scope } = await fixture(t);
  const service = runtime.sessionMessageService;
  const identity = { userId: "u1", sessionId: "s1", persistenceContext };
  await service.appendTurns({ ...identity, turns: [message("m1")] });
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  repository.saveTurnView = () => assert.fail("user meta must commit only its changed message");
  const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const result = { sourceAttachmentRef: "attach://source", summary: "parsed source" };
  assert.deepEqual(
    await service.recordUserMetaParsedResult({
      ...identity,
      userMetaSourceMessageUid: "m1",
      result,
    }),
    { userMetaParsedResults: [result] },
  );
  await assert.rejects(
    service.recordUserMetaParsedResult({
      ...identity,
      userMetaSourceMessageUid: "missing",
      result,
    }),
    { code: "USER_META_SOURCE_NOT_FOUND" },
  );
  await repository.updateSessionSettings("u1", "s1", {
    persistenceContext,
    settings: { modelAlias: "example", customTitle: "new title", selectedConnectorIds: ["one"] },
  });
  assert.deepEqual(await repository.readSelectedConnectorIds("u1", "s1", { persistenceContext }), [
    "one",
  ]);
  const exported = await repository.requireById("u1", "s1", { persistenceContext });
  assert.equal(exported.customTitle, "new title");
  assert.equal(exported.modelAlias, "example");
  assert.deepEqual(exported.messages[0].userMetaParsedResults, [result]);
  assert.equal((await pinned.readMetadata()).customTitle, undefined);
  assert.equal((await pinned.readMessage("m1")).message.userMetaParsedResults, undefined);
});

test("business append and summary commit use immutable deltas without opening the legacy turn view", async (t) => {
  const { runtime, repository, persistenceContext, scope } = await fixture(t);
  await writeFile(scope.sessionFile, "invalid legacy manifest");
  repository.saveTurnView = () => assert.fail("business delta must not save a turn view");
  const appended = await runtime.sessionMessageService.appendTurns({
    userId: "u1",
    sessionId: "s1",
    persistenceContext,
    turns: [message("m1"), message("m2")],
  });
  assert.deepEqual(
    appended.messageReceipts.map((turn) => turn.messageUid),
    ["m1", "m2"],
  );
  const pinned = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  const request = {
    userId: "u1",
    sessionId: "s1",
    persistenceContext,
    turnScopeId: "t1",
    dialogProcessId: "d1",
    checkpointId: "cp1",
    expectedCheckpointRevision: 0,
    persistedMessageUids: ["m1", "m2"],
    summarizedMessageUids: ["m1"],
    retainedMessageUids: ["m2"],
    messages: [],
  };
  const result = await runtime.sessionMessageService.commitTurnSummaryCheckpoint(request);
  assert.equal(result.committed, true);
  assert.equal(result.markedCount, 1);
  assert.equal(
    (await runtime.sessionMessageService.commitTurnSummaryCheckpoint(request)).deduplicated,
    true,
  );
  const current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.notEqual((await pinned.readMessage("m1")).message.summarized, true);
  assert.equal((await current.readMessage("m1")).message.summarized, true);
  assert.notEqual((await current.readMessage("m2")).message.summarized, true);
  const service = runtime.sessionMessageService;
  const query = { userId: "u1", sessionId: "s1", persistenceContext };
  const sources = await service.getSessionMessageSources({
    ...query,
    turnScopeIds: ["t1"],
    messageUids: ["m2", "m1"],
  });
  assert.deepEqual(
    sources.map((item) => item.messageUid),
    ["m2", "m1"],
  );
  assert.equal(sources[1].summarized, true);
  await assert.rejects(
    service.getSessionMessageSources({ ...query, turnScopeIds: ["t1"], messageUids: ["absent"] }),
    /source is missing/,
  );
  const state = await service.getTurnSummaryCheckpointState({
    ...query,
    dialogProcessId: "d1",
    turnScopeId: "t1",
  });
  assert.equal(state.checkpointRevision, 1);
  assert.equal(state.receipts[0].checkpointId, "cp1");
  assert.equal(await pinned.readCheckpointState("t1"), null);
  assert.equal((await current.readCheckpointState("t1")).checkpointRevision, 1);
  await assert.rejects(
    service.getTurnSummaryCheckpointState({
      ...query,
      dialogProcessId: "other",
      turnScopeId: "t1",
    }),
    /another dialog process/,
  );
  assert.deepEqual(
    await service.getTurnSummaryCheckpointState({
      ...query,
      dialogProcessId: "d2",
      turnScopeId: "t2",
    }),
    { dialogProcessId: "d2", turnScopeId: "t2", checkpointRevision: 0, receipts: [] },
  );
});

test("scoped commits resolve identity once, preserve replay and reject escaped capabilities", async (t) => {
  const { repository, persistenceContext } = await fixture(t);
  const locate = t.mock.method(repository, "locateSessionScope");
  const open = t.mock.method(ImmutableSessionStore, "open");
  let escaped;
  let request;
  await repository.withSessionReader(
    "u1",
    "s1",
    async ({ reader, commitChanges: commit }) => {
      escaped = commit;
      const command = {
        operationId: "scoped-commit",
        changes: { sessionMetadata: { customTitle: "scoped" } },
        committedAt: ts,
      };
      request = await reader.prepareRequest(command);
      const first = await commit(request);
      assert.equal(first.generation, reader.generation + 1);
      assert.equal((await reader.readMetadata()).customTitle, undefined);
      assert.equal((await commit(request)).replayed, true);
      await assert.rejects(
        commit(await reader.prepareRequest({ ...command, operationId: "stale" })),
        {
          code: "SESSION_GENERATION_CONFLICT",
        },
      );
    },
    { persistenceContext },
  );
  assert.equal(locate.mock.callCount(), 1);

  assert.equal(open.mock.callCount(), 1);
  await assert.rejects(escaped(request), { code: "SESSION_READER_CLOSED" });
  await using current = await repository.requireSessionReader("u1", "s1", { persistenceContext });
  assert.equal((await current.readMetadata()).customTitle, "scoped");
});

registerImmutableContextRepositoryTests({ fixture, message, ts });

registerImmutableLifecycleRepositoryTests({ fixture, ts });
