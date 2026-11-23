/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol";
import { AttachmentService } from "../../src/artifacts/index.js";
import { createPartitionSessionServices, createSessionFacade } from "../../src/session/index.js";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";
import { TEST_SCOPED_SESSION_ROOTS } from "../helpers/scoped-session-roots.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

const committedAt = "2026-11-21T00:00:00.000Z";
const identity = (sessionId = "one") => ({ userId: "user", sessionId, persistenceScope: null });

function firstSend(sessionId = "one") {
  const turnScopeId = `turn-${sessionId}`;
  return {
    ...identity(sessionId),
    parentSessionId: "",
    turnScopeId,
    commandId: `send-${sessionId}`,
    causationId: `send-${sessionId}`,
    presentationMessageId: `presentation-${sessionId}`,
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    ...createAcceptedAgentExecution(turnScopeId, sessionId),
    userMessage: {
      content: "retained input",
      userMessageId: `um-${sessionId}`,
      messageOrigin: "natural",
    },
    expectedRevision: 0,
    createSessionIfAbsent: true,
    sessionCaller: SESSION_CALLER.USER,
  };
}

async function fixture(t, limits = {}) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "partition-service-admission-"));
  const runtimes = [];
  t.after(async () => {
    const results = await Promise.allSettled(runtimes.map((runtime) => runtime.close()));
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Admission fixture shutdown failed");
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  await initializeUserWorkspace(workspaceRoot, "user");
  return () => {
    const runtime = createPartitionSessionServices(
      { workspaceRoot },
      {
        now: () => committedAt,
        attachmentService: new AttachmentService({ workspaceRoot }),
        scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
        journalLimits: journalTestLimits({ transactionBytes: 16 * 1024, ...limits }),
        maxJournals: 1,
      },
    );
    runtimes.push(runtime);
    const facade = createSessionFacade(runtime);
    const repository = runtime.repositories.sessionRepository;
    return {
      runtime,
      facade,
      read: () =>
        repository.requireSessionReader("user", "one", {
          persistenceContext: repository.treePersistenceContext("user", "one"),
        }),
    };
  };
}

test("service quota rejection preserves authority, command replay and reads across a cold reopen", async (t) => {
  const open = await fixture(t, { partitionRecords: 1, quotaPartitions: 1 });
  const { runtime, facade } = open();
  const request = firstSend();
  const accepted = await facade.applyTurnLifecycleEvent(request);
  const { sessionDir } = await facade.locateSessionScope(identity());
  const head = await readFile(join(sessionDir, "CURRENT"));
  const detail = await facade.getSessionDisplayData(identity());
  const files = await readdir(sessionDir, { recursive: true });
  await assert.rejects(facade.renameSession({ ...identity(), title: "must not publish" }), {
    code: "SESSION_STORAGE_QUOTA",
  });
  assert.deepEqual(await readFile(join(sessionDir, "CURRENT")), head);
  assert.deepEqual(await readdir(sessionDir, { recursive: true }), files);
  assert.deepEqual(await facade.getSessionDisplayData(identity()), detail);
  assert.equal((await facade.applyTurnLifecycleEvent(request)).deduplicated, true);
  await runtime.close();

  const cold = open();
  const replay = await cold.facade.applyTurnLifecycleEvent(request);
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.userMessage.messageUid, accepted.userMessage.messageUid);
  await assert.rejects(cold.facade.renameSession({ ...identity(), title: "still rejected" }), {
    code: "SESSION_STORAGE_QUOTA",
  });
  assert.deepEqual(await cold.facade.getSessionDisplayData(identity()), detail);
  assert.deepEqual(await readFile(join(sessionDir, "CURRENT")), head);
  for (const name of ["head.json", "immutable-session.format", "session.json"])
    await assert.rejects(stat(join(sessionDir, name)), { code: "ENOENT" });
});

test("service resident budget rejects a second session until its retained reader releases ownership", async (t) => {
  const open = await fixture(t);
  const { runtime, facade, read } = open();
  await facade.applyTurnLifecycleEvent(firstSend());
  await using reader = await read();
  const metadata = await reader.readMetadata();
  await assert.rejects(facade.applyTurnLifecycleEvent(firstSend("two")), {
    code: "SESSION_MUTATION_BUSY",
  });
  assert.deepEqual(await reader.readMetadata(), metadata);
  await reader.close();
  const second = await facade.applyTurnLifecycleEvent(firstSend("two"));
  assert.equal(second.sessionCreated, true);
  assert.equal((await facade.applyTurnLifecycleEvent(firstSend())).deduplicated, true);
  await runtime.close();
  const cold = open();
  assert.equal((await cold.facade.applyTurnLifecycleEvent(firstSend("two"))).deduplicated, true);
  assert.equal((await cold.facade.applyTurnLifecycleEvent(firstSend())).deduplicated, true);
});

test("service snapshot budget reports unavailable without fabricated content and recovers after reader release", async (t) => {
  const open = await fixture(t, { retentionRecords: 1 });
  const { runtime, facade, read } = open();
  await facade.applyTurnLifecycleEvent(firstSend());
  const detail = await facade.getSessionDisplayData(identity());
  await using reader = await read();
  const { sessionDir } = await facade.locateSessionScope(identity());
  const head = await readFile(join(sessionDir, "CURRENT"));
  await assert.rejects(read(), { code: "SESSION_PAGE_SNAPSHOT_CAPACITY" });
  await assert.rejects(facade.renameSession({ ...identity(), title: "must not publish" }), {
    code: "SESSION_PAGE_SNAPSHOT_CAPACITY",
  });
  const unavailable = await facade.getSessionDisplayData(identity());
  assert.equal(unavailable.exists, true);
  assert.equal(unavailable.sessions.length, 1);
  assert.equal(unavailable.sessions[0].sessionId, "one");
  assert.equal(unavailable.sessions[0].availability, "unavailable");
  assert.equal(unavailable.sessions[0].unavailableReason.code, "SESSION_PAGE_SNAPSHOT_CAPACITY");
  assert.equal(Object.hasOwn(unavailable.sessions[0], "messages"), false);
  assert.equal(Object.hasOwn(unavailable.sessions[0], "stats"), false);
  assert.equal((await reader.readMetadata()).sessionId, "one");
  assert.deepEqual(await readFile(join(sessionDir, "CURRENT")), head);
  await reader.close();
  assert.deepEqual(await facade.getSessionDisplayData(identity()), detail);
  await runtime.close();
  assert.deepEqual(await open().facade.getSessionDisplayData(identity()), detail);
});
