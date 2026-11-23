/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { borrowFixtureJournal } from "../helpers/partition-journal-lease.js";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_SCOPED_SESSION_ROOTS } from "@noobot/workspace-protocol";
import { FileSystemSessionRepository } from "../../src/session/repositories/file-system-session-repository.js";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { ExecutionReadService } from "../../src/session/services/execution-read-service.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";
import { initializePartitionSession } from "../helpers/partition-session-cases.js";
import { createTestSessionServices } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

test("agent scope discovery uses partition placement metadata and keeps damaged authority visible as an error", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "partition-agent-discovery-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const userId = "user";
  const sessionId = "agent-session";
  const parentSessionId = "parent";
  const allowedRoot = AGENT_SCOPED_SESSION_ROOTS[0];
  await initializeUserWorkspace(workspaceRoot, userId);
  const { repositories } = createTestSessionServices({ workspaceRoot });
  const { pathResolver, sessionPathResolver, sessionTreeRepository, storageService, now } =
    repositories.sessionRepository;
  const sessionDir = join(pathResolver.resolveBasePath(userId), allowedRoot, sessionId);
  const createRepository = (journal) =>
    new FileSystemSessionRepository({
      pathResolver,
      sessionPathResolver,
      sessionTreeRepository,
      storageService,
      now,
      sessionReaderAccess: createPartitionSessionReaderAccess({
        withJournalRemoval: () => assert.fail("Unexpected journal removal"),
        acquireJournal(scope) {
          assert.equal(scope.sessionDir, sessionDir);
          assert.equal(scope.sessionId, sessionId);
          return borrowFixtureJournal(journal);
        },
      }),
    });
  const journal = await PartitionJournal.create({
    root: sessionDir,
    durableAncestor: workspaceRoot,
    sessionId,
    limits: journalTestLimits(),
    publication: "collections",
  });
  t.after(() => journal.close());
  const repository = createRepository(journal);
  assert.equal(await repository._readAgentSessionScope(userId, allowedRoot, sessionId), null);
  assert.equal((await repository.listAgentSessionScopes(userId)).size, 0);
  await initializePartitionSession(
    journal,
    { sessionId, parentSessionId },
    "2026-11-20T00:00:00.000Z",
  );
  const empty = join(dirname(sessionDir), "not-a-session");
  await mkdir(empty);
  assert.equal(await repository._readAgentSessionScope(userId, allowedRoot, "not-a-session"), null);
  const scopes = await repository.listAgentSessionScopes(userId);
  assert.deepEqual([...scopes.keys()], [sessionId]);
  assert.equal(scopes.get(sessionId).parentSessionId, parentSessionId);
  {
    await using reader = await repository.requireSessionReader(userId, sessionId, {
      persistenceContext: scopes.get(sessionId).persistenceContext,
    });
    assert.equal((await reader.readMetadata()).parentSessionId, parentSessionId);
  }
  await journal.close();
  const cold = await PartitionJournal.open({ root: sessionDir, sessionId });
  t.after(() => cold.close());
  assert.equal(
    (await createRepository(cold).listAgentSessionScopes(userId)).get(sessionId).parentSessionId,
    parentSessionId,
  );
  await cold.close();
  await writeFile(join(sessionDir, "CURRENT"), "invalid published head");
  const broken = new FileSystemSessionRepository({
    pathResolver,
    sessionPathResolver,
    sessionTreeRepository,
    storageService,
    now,
    sessionReaderAccess: createPartitionSessionReaderAccess({
      withJournalRemoval: () => assert.fail("Unexpected journal removal"),
      acquireJournal: async (scope) => {
        const journal = await PartitionJournal.open({
          root: scope.sessionDir,
          sessionId: scope.sessionId,
        });
        const { createSessionJournalLease } =
          await import("@noobot/session-protocol/session-reader");
        return createSessionJournalLease({ journal, release: () => journal.close() });
      },
    }),
  });
  await assert.rejects(broken.listAgentSessionScopes(userId), { code: "SESSION_STORAGE_CORRUPT" });
  const queries = new ExecutionReadService({ sessionRepo: broken, scopedSessionRoots: [], now });
  for (const method of ["getExecution", "getExecutionChildren", "getExecutionTree"]) {
    const result = await queries[method]({ userId, executionId: "agent:root" });
    assert.equal(result.found, false);
    assert.equal(result.reason, "execution_query_incomplete");
    assert.equal(result.scopeDiscoveryFailure.code, "SESSION_STORAGE_CORRUPT");
    assert.equal(Object.hasOwn(result, "unreadableSessions"), false);
  }
});

test("declared plugin session discovery requires committed placement and uses the header identity", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "partition-plugin-discovery-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const userId = "user";
  const base = await initializeUserWorkspace(workspaceRoot, userId);
  const allowedRoot = "runtime/plugin-data/example/session";
  const relativeDir = join(allowedRoot, "owner", "node");
  const sessionDir = join(base, relativeDir);
  const sessionId = "child-session";
  const parentSessionId = "parent";
  const journal = await PartitionJournal.create({
    root: sessionDir,
    durableAncestor: base,
    sessionId,
    limits: journalTestLimits(),
    publication: "collections",
  });
  t.after(() => journal.close());
  const { repositories } = createTestSessionServices(
    { workspaceRoot },
    {
      sessionReaderAccess: createPartitionSessionReaderAccess({
        withJournalRemoval: () => assert.fail("Unexpected journal removal"),
        acquireJournal(scope) {
          assert.equal(scope.sessionDir, sessionDir);
          assert.equal(scope.sessionId, sessionId);
          return borrowFixtureJournal(journal);
        },
      }),
    },
  );
  const discover = () =>
    repositories.sessionRepository.listDeclaredSessionScopes(userId, [allowedRoot]);
  assert.equal((await discover()).size, 0);
  await initializePartitionSession(
    journal,
    { sessionId, parentSessionId },
    "2026-11-20T00:00:00.000Z",
  );
  const scopes = await discover();
  assert.deepEqual([...scopes.keys()], [sessionId]);
  assert.equal(scopes.get(sessionId).parentSessionId, parentSessionId);
  assert.equal(scopes.get(sessionId).relativeDir, relativeDir);
});
