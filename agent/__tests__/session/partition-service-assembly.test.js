/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { TURN_EVENT, TURN_PHASE, createSessionPersistenceScope } from "@noobot/session-protocol";
import { createSessionFacade, createPartitionSessionServices } from "../../src/session/index.js";
import { AttachmentService } from "../../src/artifacts/index.js";
import { TEST_SCOPED_SESSION_ROOTS } from "../helpers/scoped-session-roots.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { getFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  commitTestSessionChanges,
  executeEmptySessionCleanup,
} from "../helpers/session-services.js";
import { message } from "./partition-session-messages.test-helpers.js";

const committedAt = "2026-11-20T00:00:00.000Z";
const identity = { userId: "user", sessionId: "session", persistenceScope: null };

async function fixture(t) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "partition-service-assembly-"));
  const runtimes = [];
  t.after(async () => {
    const results = await Promise.allSettled(runtimes.map((runtime) => runtime.close()));
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Fixture runtime cleanup failed");
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
        journalLimits: journalTestLimits({ transactionBytes: 16 * 1024 }),
        maxJournals: 1,
      },
    );
    runtimes.push(runtime);
    return { runtime, facade: createSessionFacade(runtime) };
  };
  return { open };
}

function firstSend() {
  const turnScopeId = "turn";
  return {
    ...identity,
    parentSessionId: "",
    turnScopeId,
    commandId: "first-send",
    causationId: "first-send",
    presentationMessageId: "presentation",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    ...createAcceptedAgentExecution(turnScopeId, identity.sessionId),
    userMessage: { content: "first input", userMessageId: "um_first", messageOrigin: "natural" },
    expectedRevision: 0,
    createSessionIfAbsent: true,
    sessionCaller: SESSION_CALLER.USER,
  };
}

const outboxRequest = { ...identity, consumerId: "assembly" };

const outboxOperations = [
  {
    method: "getPendingAuthorityEvents",
    request: outboxRequest,
    absent: { found: false, events: [] },
  },
  {
    method: "prepareAuthorityEventDelivery",
    request: outboxRequest,
    absent: { found: false, events: [] },
  },
  {
    method: "acknowledgeAuthorityEvents",
    request: {
      ...outboxRequest,
      acknowledgements: [
        { eventId: "event", orderingDomain: "turn", orderingScopeId: "turn", sequence: 1 },
      ],
    },
    absent: { acknowledged: false, delivered: 0, deduplicated: 0 },
  },
  {
    method: "compactAuthorityEvents",
    request: { ...identity, retainDeliveredAfter: committedAt },
    absent: { compacted: false, nextRetainedDeliveryAt: null },
  },
];

for (const { method, request, absent } of outboxOperations) {
  test(`${method} returns explicit absence for an unregistered session`, async (t) => {
    const { open } = await fixture(t);
    const { facade } = open();
    assert.deepEqual(await facade[method](request), {
      ...absent,
      reason: "session_not_found",
    });
  });

  test(
    `${method} admission observes a deletion that owns the session lifecycle lock`,
    { timeout: 10000 },
    async (t) => {
      const { open } = await fixture(t);
      const { runtime, facade } = open();
      await facade.applyTurnLifecycleEvent(firstSend());
      const repository = runtime.repositories.sessionRepository;
      const lifecycleLock = repository._sessionLifecycleLockPath(
        identity.userId,
        identity.sessionId,
      );
      const planning = Promise.withResolvers();
      const releasePlan = Promise.withResolvers();
      const admitted = Promise.withResolvers();
      const lock = repository._withMutationLock.bind(repository);
      let observeOutbox = false;
      t.mock.method(repository, "_withMutationLock", (key, operation) => {
        if (observeOutbox && key === lifecycleLock) admitted.resolve();
        return lock(key, operation);
      });
      const deleting = facade.deleteSessionBranch(
        { userId: identity.userId, sessionIds: [identity.sessionId] },
        async (stage) => {
          planning.resolve();
          await releasePlan.promise;
          return executeEmptySessionCleanup(stage);
        },
      );
      let pending;
      try {
        await Promise.race([planning.promise, deleting]);
        observeOutbox = true;
        pending = facade[method](request);
        await Promise.race([admitted.promise, pending]);
      } finally {
        releasePlan.resolve();
      }
      const deletedResult = { ...absent, reason: "session_deleted" };
      await Promise.all([
        assert.deepEqual(await deleting, { ok: true, deletedSessionIds: [identity.sessionId] }),
        pending.then((result) => assert.deepEqual(result, deletedResult)),
      ]);
      assert.deepEqual(await facade[method](request), deletedResult);
    },
  );

  test(`${method} rejects a registered session with no partition authority`, async (t) => {
    const { open } = await fixture(t);
    const { runtime, facade } = open();
    await facade.applyTurnLifecycleEvent(firstSend());
    const { sessionDir } = await facade.locateSessionScope(identity);
    await runtime.close();
    await rm(join(sessionDir, "CURRENT"));
    const cold = open();
    assert.deepEqual(await cold.facade.listSessionIds(identity), [identity.sessionId]);
    await assert.rejects(cold.facade[method](request), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  });
}

test("service assembly and facade share partition creation, settings, display, artifacts and cold replay", async (t) => {
  const { open } = await fixture(t);
  const { runtime, facade } = open();
  const accepted = await facade.applyTurnLifecycleEvent(firstSend());
  assert.equal(accepted.sessionCreated, true);
  assert.equal(accepted.aggregateVersion, 1);
  assert.deepEqual(await facade.listSessionIds(identity), [identity.sessionId]);
  const placement = await facade.locateSessionScope(identity);
  const headPath = join(placement.sessionDir, "CURRENT");
  await facade.renameSession({ ...identity, title: "Partition title" });
  const detail = await facade.getSessionDisplayData(identity);
  await assert.rejects(
    runtime.scopedArtifactReader.readScopedSessionSnapshot({
      userId: identity.userId,
      authoritySessionId: identity.sessionId,
      sessionDir: placement.sessionDir,
    }),
    { code: "SESSION_NOT_FOUND" },
  );
  const thinkingRequest = {
    ...identity,
    turnScopeId: "turn",
    dialogProcessId: accepted.dialogProcessId,
    limit: 1,
    cursor: null,
  };
  const thinking = await facade.getSessionThinkingDetail(thinkingRequest);
  assert.equal(thinking.exists, true);
  assert.equal(thinking.messages[0].messageUid, accepted.userMessage.messageUid);
  const head = await readFile(headPath);
  for (const name of ["head.json", "immutable-session.format", "session.json"])
    await assert.rejects(stat(join(placement.sessionDir, name)), { code: "ENOENT" });
  await runtime.close();

  const cold = open();
  const replay = await cold.facade.applyTurnLifecycleEvent(firstSend());
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.sessionCreated, false);
  assert.equal(replay.userMessage.messageUid, accepted.userMessage.messageUid);
  assert.deepEqual(await readFile(headPath), head);
  assert.deepEqual(await cold.facade.getSessionDisplayData(identity), detail);
  assert.deepEqual(await cold.facade.getSessionThinkingDetail(thinkingRequest), thinking);
  const repository = cold.runtime.repositories.sessionRepository;
  await using reader = await repository.requireSessionReader(identity.userId, identity.sessionId, {
    persistenceContext: repository.treePersistenceContext(identity.userId, identity.sessionId),
  });
  const { events } = await reader.readOutboxPage({ consumerId: "assembly" });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventId, (await reader.readCommand("first-send")).eventId);
});

test("service assembly rejects a competing authority without changing the committed partition", async (t) => {
  const { open } = await fixture(t);
  const { runtime, facade } = open();
  await facade.applyTurnLifecycleEvent(firstSend());
  const { sessionDir } = await facade.locateSessionScope(identity);
  const head = await readFile(join(sessionDir, "CURRENT"));
  const competing = join(sessionDir, "head.json");
  await writeFile(competing, "foreign authority");
  await assert.rejects(facade.renameSession({ ...identity, title: "rejected" }), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  await assert.rejects(
    runtime.scopedArtifactReader.readScopedSessionSnapshot({
      userId: identity.userId,
      authoritySessionId: identity.sessionId,
      sessionDir,
    }),
    {
      code: "SESSION_STORAGE_CORRUPT",
    },
  );
  assert.deepEqual(await readFile(join(sessionDir, "CURRENT")), head);
  assert.equal(await readFile(competing, "utf8"), "foreign authority");
  await runtime.close();
});

test("scoped first send stays outside the session tree and cold replays through its declared placement", async (t) => {
  const { open } = await fixture(t);
  const { runtime, facade } = open();
  const parentSessionId = "parent";
  const allowedRoot = "runtime/plugin-data/workflow/session";
  const scopedIdentity = {
    ...identity,
    persistenceScope: createSessionPersistenceScope({
      scopeId: "agent:session",
      parentSessionId,
      allowedRoot,
      relativeDir: `${allowedRoot}/run/node`,
    }),
  };
  const request = { ...firstSend(), ...scopedIdentity, parentSessionId };
  const accepted = await facade.applyTurnLifecycleEvent(request);
  assert.equal(accepted.sessionCreated, true);
  assert.deepEqual(await facade.listSessionIds(identity), []);
  const placement = await facade.locateSessionScope(scopedIdentity);
  assert.equal(placement.resolvedParentSessionId, parentSessionId);
  const headPath = join(placement.sessionDir, "CURRENT");
  const head = await readFile(headPath);
  const bundle = await facade.getSessionBundle(scopedIdentity);
  assert.equal(bundle.session.parentSessionId, parentSessionId);
  assert.equal(bundle.session.messages[0].messageUid, accepted.userMessage.messageUid);
  await runtime.close();

  const cold = open();
  assert.deepEqual(await cold.facade.locateSessionScope(scopedIdentity), placement);
  const replay = await cold.facade.applyTurnLifecycleEvent(request);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.sessionCreated, false);
  assert.equal(replay.userMessage.messageUid, accepted.userMessage.messageUid);
  assert.deepEqual(await cold.facade.listSessionIds(identity), []);
  assert.deepEqual(await cold.facade.getSessionBundle(scopedIdentity), bundle);
  assert.deepEqual(await readFile(headPath), head);
  const snapshot = await cold.facade.readScopedSessionSnapshot({
    userId: identity.userId,
    authoritySessionId: parentSessionId,
    sessionDir: placement.sessionDir,
  });
  assert.equal(snapshot.sessionSummary.sessionId, identity.sessionId);
  assert.equal(snapshot.sessionSummary.messages[0].messageUid, accepted.userMessage.messageUid);
});

test("partition service shutdown waits for an active reader and rejects new journal access", async (t) => {
  const { open } = await fixture(t);
  const { runtime, facade } = open();
  await facade.applyTurnLifecycleEvent(firstSend());
  const repository = runtime.repositories.sessionRepository;
  const persistenceContext = runtime.createSessionPersistenceContext(identity);
  await using reader = await repository.requireSessionReader(identity.userId, identity.sessionId, {
    persistenceContext,
  });
  let closed = false;
  const closing = runtime.close();
  const completion = closing.then(() => {
    closed = true;
  });
  assert.equal(runtime.close(), closing);
  try {
    assert.equal((await reader.readMetadata()).sessionId, identity.sessionId);
    assert.equal(closed, false);
    await assert.rejects(facade.getSessionBundle(identity), { code: "SESSION_STORAGE_CLOSED" });
  } finally {
    await reader.close();
  }
  await completion;
  assert.equal(closed, true);
  const cold = open();
  assert.equal((await cold.facade.getSessionBundle(identity)).exists, true);
});

test("partition service retains thinking pages across commits and releases unfinished pages on shutdown", async (t) => {
  const { open } = await fixture(t);
  const { runtime, facade } = open();
  const accepted = await facade.applyTurnLifecycleEvent(firstSend());
  const append = (messageUid) =>
    commitTestSessionChanges(runtime, {
      ...identity,
      changes: {
        messages: [
          {
            ...message(identity.sessionId, messageUid),
            turnScopeId: "turn",
            dialogProcessId: accepted.dialogProcessId,
          },
        ],
      },
    });
  await append("second");
  const selection = {
    ...identity,
    turnScopeId: "turn",
    dialogProcessId: accepted.dialogProcessId,
    cursor: null,
    limit: 1,
  };
  const first = await facade.getSessionThinkingDetail(selection);
  assert.equal(first.messageCount, 2);
  assert.ok(first.nextCursor);
  await append("third");
  const second = await facade.getSessionThinkingDetail({ ...selection, cursor: first.nextCursor });
  assert.equal(second.generation, first.generation);
  assert.equal(second.messageCount, 2);
  assert.equal(second.messages[0].messageUid, "second");
  assert.equal(second.nextCursor, null);
  const current = await facade.getSessionThinkingDetail(selection);
  assert.equal(current.messageCount, 3);
  assert.ok(current.nextCursor);
  await runtime.close();
  const cold = open();
  await assert.rejects(
    cold.facade.getSessionThinkingDetail({
      ...selection,
      cursor: current.nextCursor,
    }),
    { code: "SESSION_PAGE_SNAPSHOT_EXPIRED" },
  );
  const fresh = await cold.facade.getSessionThinkingDetail(selection);
  assert.equal(fresh.messageCount, 3);
});

test("partition service reports retained page cleanup failure without waiting on its journal lease", async (t) => {
  const { open } = await fixture(t);
  const { runtime, facade } = open();
  const accepted = await facade.applyTurnLifecycleEvent(firstSend());
  await commitTestSessionChanges(runtime, {
    ...identity,
    changes: {
      messages: [
        {
          ...message(identity.sessionId, "second"),
          turnScopeId: "turn",
          dialogProcessId: accepted.dialogProcessId,
        },
      ],
    },
  });
  const page = await facade.getSessionThinkingDetail({
    ...identity,
    turnScopeId: "turn",
    dialogProcessId: accepted.dialogProcessId,
    cursor: null,
    limit: 1,
  });
  assert.ok(page.nextCursor);
  const { sessionDir } = await facade.locateSessionScope(identity);
  const retentions = join(sessionDir, "retentions");
  assert.deepEqual(await readdir(retentions), ["0.json"]);
  const slot = join(retentions, "0.json");
  const adapter = getFsAdapter();
  const failure = Object.assign(new Error("retention removal failed on shutdown"), { code: "EIO" });
  setFsAdapter({
    ...adapter,
    async rm(file, ...args) {
      if (String(file) === slot) throw failure;
      return adapter.rm(file, ...args);
    },
  });
  let timer;
  try {
    const closing = runtime.close();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Shutdown did not report failed cleanup")), 2000);
    });
    await assert.rejects(Promise.race([closing, deadline]), (cause) => {
      assert.ok(cause instanceof AggregateError);
      assert.equal(cause.errors[0].code, "SESSION_SNAPSHOT_RELEASE_UNCERTAIN");
      assert.equal(cause.errors[0].cause, failure);
      return true;
    });
    await assert.rejects(facade.getSessionBundle(identity), { code: "SESSION_STORAGE_CLOSED" });
    await stat(slot);
  } finally {
    clearTimeout(timer);
    setFsAdapter(adapter);
  }
  const retry = runtime.close();
  assert.equal(runtime.close(), retry);
  await retry;
  await assert.rejects(stat(slot), { code: "ENOENT" });
});
