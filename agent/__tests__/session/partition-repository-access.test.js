/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SESSION_ERROR_CODE, TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  IMMUTABLE_SESSION_FORMAT_FILE,
  IMMUTABLE_SESSION_HEAD_FILE,
} from "@noobot/session-protocol/immutable-storage";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { createJournalOwner, createRepository } from "./partition-repository-access.replay.js";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { initializePartitionSession } from "../helpers/partition-session-cases.js";
import {
  persistSessionDeletionMarkers,
  createTestSessionServices,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import {
  committedAt,
  message,
  scope as messageScope,
} from "./partition-session-messages.test-helpers.js";

async function replayInNewProcess(input) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      import.meta.resolve("@noobot/shared/testing/runtime-params"),
      fileURLToPath(new URL("partition-repository-access.replay.js", import.meta.url)),
      JSON.stringify(input),
    ],
    { timeout: 15000 },
  );
  return JSON.parse(stdout);
}

test("business first send survives partition publication followed by a placement failure", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "partition-first-send-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const userId = "user";
  const sessionId = "session";
  const parentSessionId = "";
  const turnScopeId = "turn-1";
  const commandId = "first-send";
  await initializeUserWorkspace(workspaceRoot, userId);
  const { repositories } = createTestSessionServices({ workspaceRoot }, { now: () => committedAt });
  const { sessionDir } = await repositories.sessionRepository.sessionPathResolver.placeSessionScope(
    userId,
    { sessionId, parentSessionId },
  );
  const scope = { sessionDir, sessionId, parentSessionId };
  await using owner = createJournalOwner(workspaceRoot, { transactionBytes: 16 * 1024 });
  const initial = createRepository({ workspaceRoot, scope, owner });
  const request = {
    userId,
    sessionId,
    parentSessionId,
    turnScopeId,
    commandId,
    causationId: commandId,
    presentationMessageId: "first-send-presentation",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    ...createAcceptedAgentExecution(turnScopeId, sessionId),
    userMessage: { content: "first message", userMessageId: "um_first", messageOrigin: "natural" },
    expectedRevision: 0,
    createSessionIfAbsent: true,
    sessionCaller: SESSION_CALLER.USER,
  };
  const submit = (sessionRepo) =>
    new SessionMessageService({
      sessionRepo,
      now: () => committedAt,
      allocateDialogProcessId: () => "first-dialog",
    }).applyTurnLifecycleEvent({
      ...request,
      persistenceContext: sessionRepo.treePersistenceContext(userId, sessionId),
    });

  initial.commitSessionPlacement = async () => {
    throw new Error("injected placement failure after partition publication");
  };
  await assert.rejects(submit(initial), /injected placement failure after partition publication/);
  assert.deepEqual(await initial.listSessionIds(userId), []);
  const headPath = join(sessionDir, "CURRENT");
  const committedHead = await readFile(headPath);
  await owner.close();

  await using reopened = createJournalOwner(workspaceRoot);
  const cold = createRepository({ workspaceRoot, scope, owner: reopened });
  const replay = await submit(cold);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.sessionCreated, false);
  assert.equal(replay.aggregateVersion, 1);
  assert.deepEqual(await readFile(headPath), committedHead);
  assert.deepEqual(await cold.listSessionIds(userId), [sessionId]);

  await using reader = await cold.requireSessionReader(userId, sessionId, {
    persistenceContext: cold.treePersistenceContext(userId, sessionId),
  });
  const { records } = await reader.readMessagePage();
  assert.equal(records.length, 1);
  assert.equal(records[0].message.messageUid, replay.userMessage.messageUid);
  assert.equal(records[0].message.content, request.userMessage.content);
  const { events } = await reader.readOutboxPage({ consumerId: "test-consumer" });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventId, (await reader.readCommand(commandId)).eventId);
  for (const file of [IMMUTABLE_SESSION_FORMAT_FILE, IMMUTABLE_SESSION_HEAD_FILE]) {
    await assert.rejects(stat(join(sessionDir, file)), { code: "ENOENT" });
  }
});

test("filesystem repository reads and commits through one partition authority", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "partition-repository-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const userId = "user";
  const sessionId = "session";
  const parentSessionId = "";
  await initializeUserWorkspace(workspaceRoot, userId);
  const { repositories } = createTestSessionServices({ workspaceRoot }, { now: () => committedAt });
  const { sessionPathResolver } = repositories.sessionRepository;
  const persistenceContext = repositories.sessionRepository.treePersistenceContext(
    userId,
    sessionId,
  );
  const { sessionDir } = await sessionPathResolver.placeSessionScope(userId, {
    sessionId,
    parentSessionId,
  });
  await using owner = createJournalOwner(workspaceRoot);
  const scope = { sessionDir, sessionId, parentSessionId };
  const repository = createRepository({ workspaceRoot, scope, owner });
  const options = { persistenceContext };
  assert.equal(await repository.findSessionReader(userId, sessionId, options), null);
  {
    await using lease = await owner.acquire(scope, { create: true });
    await initializePartitionSession(lease.journal, { sessionId, parentSessionId }, committedAt);
  }
  await repository.commitSessionPlacement(
    userId,
    { sessionId, parentSessionId, caller: "user" },
    persistenceContext,
  );
  const created = await repository.withSessionReader(
    userId,
    sessionId,
    async ({ reader, commitChanges, readCurrent }) => {
      const request = await reader.prepareRequest({
        operationId: "create-message",
        committedAt,
        changes: { messages: [message(sessionId, "m1")] },
      });
      const receipt = await commitChanges(request);
      assert.deepEqual((await reader.readMessagePage()).records, []);
      await readCurrent(async (current) => {
        assert.equal(current.generation, receipt.generation);
        assert.equal(
          (await current.readDisplaySourcePage({ limit: 1 })).records[0].message.messageUid,
          "m1",
        );
      });
      return receipt;
    },
    options,
  );
  let [previous] = created.result.messageReceipts;
  let lastAppend;
  let expectedContent = "m1";
  for (const [index, content] of [" first", " second"].entries()) {
    const beforeAppend = expectedContent;
    expectedContent += content;
    lastAppend = await repository.withSessionReader(
      userId,
      sessionId,
      async ({ reader, commitChanges, readCurrent }) => {
        const request = await reader.prepareRequest({
          operationId: `append-${index}`,
          committedAt,
          changes: {
            messageContentAppends: [
              {
                ...messageScope,
                messageUid: "m1",
                owner: previous.owner,
                expectedContentReference: previous.contentReference,
                content,
              },
            ],
          },
        });
        const receipt = await commitChanges(request);
        const [updated] = receipt.result.messageReceipts;
        assert.deepEqual(updated.owner, previous.owner);
        assert.notEqual(updated.contentReference, previous.contentReference);
        const pinned = await reader.readMessagePage({ limit: 1 });
        assert.equal(pinned.records[0].message.content, beforeAppend);
        await readCurrent(async (current) => {
          assert.equal(current.generation, receipt.generation);
          const page = await current.readMessagePage({ limit: 1 });
          assert.equal(page.records[0].message.content, expectedContent);
          assert.equal(page.nextCursor, null);
        });
        return { serialized: JSON.stringify(request), receipt };
      },
      options,
    );
    [previous] = lastAppend.receipt.result.messageReceipts;
  }
  const { serialized, receipt } = lastAppend;
  const context = await repository.requireContextSource(userId, sessionId, {
    ...options,
    historyLimit: 1,
  });
  assert.deepEqual(
    context.messages.map(({ messageUid }) => messageUid),
    ["m1"],
  );
  const headPath = join(sessionDir, "CURRENT");
  const before = await readFile(headPath);
  const legacy = repositories.sessionRepository.sessionReaderAccess;
  const expected = { code: "SESSION_STORAGE_AUTHORITY_MISMATCH" };
  let mutationEntered = false;
  await assert.rejects(legacy.readPlacement(scope), expected);
  await assert.rejects(legacy.recover(scope), expected);
  await assert.rejects(legacy.open(scope), expected);
  await assert.rejects(legacy.openArtifact({ sessionDir }), expected);
  await assert.rejects(
    legacy.withMutation(scope, () => {
      mutationEntered = true;
    }),
    expected,
  );
  assert.equal(mutationEntered, false);
  await assert.rejects(
    legacy.create(scope, {
      session: repository.createInitialSession({ sessionId, parentSessionId, caller: "user" }),
      operationId: "wrong-authority",
      initialTurn: null,
      scopedMetadata: null,
    }),
    expected,
  );
  assert.deepEqual(await readFile(headPath), before);
  const display = await repository.readSessionDisplaySummary(userId, sessionId, options);
  assert.equal(display.generation, receipt.generation);
  assert.equal(display.messages[0].content, expectedContent);
  assert.equal(display.messages[0].sessionOrdinal, 1);
  await owner.close();
  const replay = await replayInNewProcess({ workspaceRoot, scope, userId, serialized });
  assert.equal(receipt.replayed, false);
  assert.deepEqual(replay, { ...receipt, replayed: true });
  assert.deepEqual(await readFile(headPath), before);
  await using reopened = createJournalOwner(workspaceRoot);
  const cold = createRepository({ workspaceRoot, scope, owner: reopened });
  assert.deepEqual(await cold.readSessionDisplaySummary(userId, sessionId, options), display);
  {
    await using coldReader = await cold.requireSessionReader(userId, sessionId, options);
    const chunks = [];
    const encoded = Buffer.from(JSON.stringify(expectedContent));
    let byteOffset = 0;
    for (const maxBytes of [2, 6, encoded.length]) {
      const page = await coldReader.readMessageContentPage({
        messageUid: "m1",
        byteOffset,
        expectedContentReference: previous.contentReference,
        maxBytes,
      });
      assert.equal(page.encoding, "json-utf8-base64");
      assert.equal(page.contentReference, previous.contentReference);
      assert.equal(page.byteOffset, byteOffset);
      const nextByteOffset = Math.min(byteOffset + maxBytes, encoded.length);
      const chunk = Buffer.from(page.dataBase64, "base64");
      assert.deepEqual(chunk, encoded.subarray(byteOffset, nextByteOffset));
      chunks.push(chunk);
      assert.equal(page.nextByteOffset, nextByteOffset);
      byteOffset = page.nextByteOffset;
      assert.equal(page.hasMore, byteOffset < encoded.length);
    }
    assert.equal(JSON.parse(Buffer.concat(chunks).toString("utf8")), expectedContent);
  }
  assert.deepEqual(
    (await cold.requireById(userId, sessionId, options)).messages.map(
      ({ messageUid }) => messageUid,
    ),
    ["m1"],
  );
  for (const file of [IMMUTABLE_SESSION_FORMAT_FILE, IMMUTABLE_SESSION_HEAD_FILE]) {
    await assert.rejects(stat(join(sessionDir, file)), { code: "ENOENT" });
  }
  await persistSessionDeletionMarkers(cold, userId, [sessionId]);
  assert.equal(await cold.findSessionReader(userId, sessionId, options), null);
  await assert.rejects(cold.requireSessionReader(userId, sessionId, options), {
    code: SESSION_ERROR_CODE.SESSION_DELETED,
  });
});
