/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { SESSION_ERROR_CODE, TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { decodeMessageContentPage } from "@noobot/session-protocol/message-read-budget";
import { selectMainSessionDetailEntry } from "@noobot/session-protocol/session-detail";
import { AttachmentService } from "../../src/artifacts/index.js";
import { createPartitionSessionServices, createSessionFacade } from "../../src/session/index.js";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";
import { TEST_SCOPED_SESSION_ROOTS } from "../helpers/scoped-session-roots.js";
import { commitTestSessionChanges } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { message } from "./partition-session-messages.test-helpers.js";

const committedAt = "2026-11-20T00:00:00.000Z";
const identity = { userId: "user", sessionId: "session", persistenceScope: null };

async function fixture(t) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "partition-service-mutations-"));
  const runtimes = [];
  t.after(async () => {
    for (const runtime of runtimes) await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  await initializeUserWorkspace(workspaceRoot, identity.userId);
  const open = () => {
    const runtime = createPartitionSessionServices(
      { workspaceRoot },
      {
        now: () => committedAt,
        attachmentService: new AttachmentService({ workspaceRoot }),
        scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
        journalLimits: journalTestLimits({ transactionBytes: 16 * 1024, pageRecords: 1 }),
        maxJournals: 1,
      },
    );
    runtimes.push(runtime);
    const facade = createSessionFacade(runtime);
    const repository = runtime.repositories.sessionRepository;
    const read = () =>
      repository.requireSessionReader(identity.userId, identity.sessionId, {
        persistenceContext: repository.treePersistenceContext(identity.userId, identity.sessionId),
      });
    return { runtime, facade, read };
  };
  const current = open();
  const accepted = await current.facade.applyTurnLifecycleEvent({
    ...identity,
    parentSessionId: "",
    turnScopeId: "retained",
    commandId: "first-send",
    causationId: "first-send",
    presentationMessageId: "presentation-retained",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    ...createAcceptedAgentExecution("retained", identity.sessionId),
    userMessage: { content: "first input", userMessageId: "um_first", messageOrigin: "natural" },
    expectedRevision: 0,
    createSessionIfAbsent: true,
    sessionCaller: SESSION_CALLER.USER,
  });
  const answer = (uid, turnScopeId) => ({
    ...message(identity.sessionId, uid),
    turnScopeId,
    dialogProcessId: accepted.dialogProcessId,
    presentationMessageId: `presentation-${turnScopeId}`,
  });
  const commit = (runtime, changes) => commitTestSessionChanges(runtime, { ...identity, changes });
  await commit(current.runtime, { messages: [answer("anchor", "removed")] });
  await commit(current.runtime, { messages: [answer("tail", "retained")] });
  const { sessionDir } = await current.facade.locateSessionScope(identity);
  return { ...current, open, commit, answer, accepted, headPath: join(sessionDir, "CURRENT") };
}

function mutationRequest(operation, overrides = {}) {
  return {
    ...identity,
    anchor: { turnScopeId: "removed" },
    commandId: operation,
    ...(operation === "replaceTurn"
      ? { turnScopeId: "replacement", newContent: "edited input", attachments: [] }
      : {}),
    ...overrides,
  };
}

async function readMessageOrder(reader) {
  const uids = [];
  let cursor = null;
  do {
    const page = await reader.readSessionMessageOrderPage({ cursor, limit: 1 });
    uids.push(...page.entries);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return uids;
}

for (const operation of ["deleteFromMessage", "replaceTurn"]) {
  test(`partition facade ${operation} returns original evidence when another commit wins the readback window`, async (t) => {
    const current = await fixture(t);
    const request = mutationRequest(operation);
    const repository = current.runtime.repositories.sessionRepository;
    const withSessionReader = repository.withSessionReader.bind(repository);
    await using before = await current.read();
    const hook = t.mock.method(repository, "withSessionReader", (user, session, run, options) =>
      withSessionReader(
        user,
        session,
        ({ readCurrent, ...ports }) =>
          run({
            ...ports,
            readCurrent: async (read) => {
              hook.mock.restore();
              const turnScopeId = operation === "replaceTurn" ? "replacement" : "retained";
              await using committed = await current.read();
              const [
                {
                  message: { dialogProcessId },
                },
              ] = (await committed.readMessagePage({ limit: 1 })).records;
              await current.commit(current.runtime, {
                messages: [{ ...current.answer("concurrent", turnScopeId), dialogProcessId }],
              });
              return readCurrent(read);
            },
          }),
        options,
      ),
    );
    const response = await current.facade[operation](request);
    assert.equal(response.deduplicated, false);
    assert.equal(response.projection.generation, before.generation + 1);
    assert.equal(response.generation, before.generation + 2);
    await before.close();
    await current.runtime.close();

    const cold = current.open();
    const replay = await cold.facade[operation](request);
    assert.deepEqual(replay, { ...response, deduplicated: true });
  });

  test(`partition facade ${operation} publishes one mutation, preserves its old reader and cold replays its response`, async (t) => {
    const current = await fixture(t);
    const request = mutationRequest(operation);
    await using before = await current.read();
    const selection = { cursor: null, direction: "backward", limit: 1, maxBytes: 4096 };
    const originalPage = await before.readDisplayPage(selection);
    assert.equal(originalPage.stats.messageCount, 3);
    assert.equal(originalPage.messages.length, 1);
    assert.ok(originalPage.nextCursor);
    const original = await before.exportSession();
    assert.equal(original.messages.length, 3);
    const result = await current.facade[operation](request);
    assert.equal(result.deduplicated, false);
    assert.equal(result.generation, before.generation + 1);
    assert.deepEqual(await before.exportSession(), original);
    assert.deepEqual(result.projection.messageSuffix, {
      firstOrdinal: operation === "replaceTurn" ? 1 : 2,
      previousMessageCount: 3,
    });
    await using after = await current.read();
    assert.equal(await after.readTurnState("retained"), null);
    assert.deepEqual((await after.readOutboxPage({ consumerId: "integration" })).events, []);
    const retained = await after.exportSession();
    assert.equal(retained.messages.length, 1);
    assert.equal(
      retained.messages[0].content,
      operation === "replaceTurn" ? "edited input" : "first input",
    );
    const detail = selectMainSessionDetailEntry(
      await current.facade.getSessionDisplayData(identity),
    );
    assert.equal(detail.generation, result.generation);
    assert.equal(detail.stats.messageCount, retained.messages.length);
    assert.equal(detail.stats.displayMessageCount, detail.messages.length);
    const published = await after.readDisplayPage(selection);
    assert.equal(published.generation, detail.generation);
    assert.deepEqual(published.stats, detail.stats);
    assert.equal(published.messages.length, 1);
    const [{ contentReference, contentBytes, ...metadata }] = published.messages;
    assert.equal(Object.hasOwn(metadata, "content"), false);
    const bodySelection = {
      messageUid: metadata.messageUid,
      expectedContentReference: contentReference,
      byteOffset: 0,
      maxBytes: contentBytes,
    };
    const bodyPage = await after.readMessageContentPage(bodySelection);
    const { bytes } = decodeMessageContentPage(bodyPage, bodySelection, contentBytes);
    const content = JSON.parse(new TextDecoder().decode(bytes));
    assert.deepEqual([{ ...metadata, content }], detail.messages.slice(-1));
    assert.deepEqual(await before.readDisplayPage(selection), originalPage);
    await assert.rejects(after.readDisplayPage({ ...selection, cursor: originalPage.nextCursor }), {
      code: "SESSION_PAGE_CURSOR_CONFLICT",
    });
    assert.deepEqual(
      detail.messages.filter(({ role }) => role === "user").map(({ messageUid }) => messageUid),
      [retained.messages[0].messageUid],
    );
    await before.close();
    await after.close();
    await current.runtime.close();

    const cold = current.open();
    const head = await readFile(current.headPath);
    const replay = await cold.facade[operation](request);
    assert.equal(replay.deduplicated, true);
    assert.deepEqual(replay.projection, result.projection);
    assert.deepEqual(replay.displayMessages, result.displayMessages);
    assert.equal(replay.generation, result.generation);
    assert.deepEqual(await readFile(current.headPath), head);
    assert.deepEqual(
      selectMainSessionDetailEntry(await cold.facade.getSessionDisplayData(identity)),
      detail,
    );
    {
      await using reopened = await cold.read();
      assert.deepEqual(await reopened.readDisplayPage(selection), published);
    }

    const turnScopeId = operation === "replaceTurn" ? "replacement" : "retained";
    const dialogProcessId = retained.messages[0].dialogProcessId;
    await current.commit(cold.runtime, {
      messages: [{ ...current.answer("later", turnScopeId), dialogProcessId }],
    });
    const advanced = await readFile(current.headPath);
    const laterReplay = await cold.facade[operation](request);
    assert.equal(laterReplay.deduplicated, true);
    assert.deepEqual(laterReplay.projection, result.projection);
    assert.equal(laterReplay.generation, result.generation + 1);
    assert.deepEqual(await readFile(current.headPath), advanced);
    const latest = selectMainSessionDetailEntry(await cold.facade.getSessionDisplayData(identity));
    assert.equal(latest.generation, laterReplay.generation);
    assert.equal(latest.stats.messageCount, 2);
    assert.equal(latest.stats.displayMessageCount, latest.messages.length);
    assert.ok(latest.messages.some(({ messageUid }) => messageUid === "later"));
    await using final = await cold.read();
    assert.equal((await final.exportSession()).messages.length, 2);
    assert.equal(await final.readTurnState("retained"), null);
    assert.deepEqual((await final.readOutboxPage({ consumerId: "integration" })).events, []);
  });

  test(`partition facade ${operation} rejects an oversized suffix atomically and keeps small mutations available after cold retry`, async (t) => {
    const current = await fixture(t);
    for (let index = 0; index < 24; index += 1) {
      await current.commit(current.runtime, {
        messages: [current.answer(`extra-${index}`, `extra-turn-${index}`)],
      });
    }
    const request = mutationRequest(operation);
    await using before = await current.read();
    const original = {
      order: await readMessageOrder(before),
      metadata: await before.readMetadata(),
      lifecycle: await before.readLifecycleHead(),
      turn: await before.readTurnState("retained"),
      outbox: await before.readOutboxPage({ consumerId: "integration" }),
    };
    assert.equal(original.order.length, 27);
    const head = await readFile(current.headPath);
    const assertUnchanged = async (reader) => {
      assert.equal(reader.generation, before.generation);
      assert.deepEqual(await readMessageOrder(reader), original.order);
      assert.deepEqual(await reader.readMetadata(), original.metadata);
      assert.deepEqual(await reader.readLifecycleHead(), original.lifecycle);
      assert.deepEqual(await reader.readTurnState("retained"), original.turn);
      assert.deepEqual(await reader.readOutboxPage({ consumerId: "integration" }), original.outbox);
      assert.equal(await reader.readCommand(request.commandId), null);
      assert.equal(await reader.readTurnDescriptor("replacement"), null);
      assert.deepEqual(await readFile(current.headPath), head);
    };
    await assert.rejects(current.facade[operation](request), {
      code: "SESSION_TRANSACTION_BUDGET",
    });
    await using after = await current.read();
    await assertUnchanged(after);
    await assertUnchanged(before);
    await after.close();
    await before.close();
    await current.runtime.close();

    const cold = current.open();
    await assert.rejects(cold.facade[operation](request), {
      code: "SESSION_TRANSACTION_BUDGET",
    });
    await using retried = await cold.read();
    await assertUnchanged(retried);
    const result = await cold.facade.deleteFromMessage(
      mutationRequest("deleteFromMessage", {
        anchor: { turnScopeId: "extra-turn-23" },
        commandId: "small-deletion",
      }),
    );
    assert.equal(result.deduplicated, false);
    assert.equal(result.generation, retried.generation + 1);
    await using final = await cold.read();
    assert.deepEqual(await readMessageOrder(final), original.order.slice(0, -1));
    assert.equal(await final.readCommand(request.commandId), null);
  });

  test(`partition facade ${operation} preserves command identity and concurrency checks across restart`, async (t) => {
    const current = await fixture(t);
    const request = mutationRequest(operation);
    await using before = await current.read();
    const version = (await before.readMetadata()).aggregateVersion;
    const head = await readFile(current.headPath);
    await assert.rejects(
      current.facade[operation]({
        ...request,
        expectedAggregateVersion: version - 1,
      }),
      { code: SESSION_ERROR_CODE.AGGREGATE_VERSION_CONFLICT, statusCode: 409 },
    );
    await assert.rejects(
      current.facade[operation]({
        ...request,
        anchor: { turnScopeId: "absent" },
      }),
      { code: "SESSION_MESSAGE_NOT_FOUND", statusCode: 404 },
    );
    assert.deepEqual(await readFile(current.headPath), head);
    await using rejected = await current.read();
    assert.equal(await rejected.readCommand(request.commandId), null);
    await rejected.close();
    await before.close();

    const result = await current.facade[operation]({
      ...request,
      expectedAggregateVersion: version,
    });
    await current.runtime.close();
    const cold = current.open();
    const committed = await readFile(current.headPath);
    await assert.rejects(
      cold.facade[operation]({
        ...request,
        anchor: { turnScopeId: "retained" },
      }),
      { code: SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED, statusCode: 409 },
    );
    const other = operation === "replaceTurn" ? "deleteFromMessage" : "replaceTurn";
    await assert.rejects(
      cold.facade[other](
        mutationRequest(other, {
          commandId: request.commandId,
        }),
      ),
      { code: SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED, statusCode: 409 },
    );
    const replay = await cold.facade[operation]({ ...request, expectedAggregateVersion: version });
    assert.equal(replay.deduplicated, true);
    assert.deepEqual(replay.projection, result.projection);
    assert.deepEqual(await readFile(current.headPath), committed);
  });
}
