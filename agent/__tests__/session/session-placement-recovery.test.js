/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionReaderAccess } from "../helpers/partition-reader-fixture.js";
import assert from "node:assert/strict";
import { borrowFixtureJournal } from "../helpers/partition-journal-lease.js";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PARTITION_JOURNAL_HEAD_FILE } from "@noobot/session-protocol/partition-journal";
import { FileSystemSessionRepository } from "../../src/session/repositories/file-system-session-repository.js";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";
import { createTestSessionServices } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

const committedAt = "2026-11-20T00:00:00.000Z";

for (const acquisition of ["borrowed", "owned"]) {
  test(`${acquisition} partition placement recovery registers committed authority after failure and cold reopen`, async (t) => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "session-placement-recovery-"));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const userId = "user";
    const sessionId = "session";
    await initializeUserWorkspace(workspaceRoot, userId);
    const { repositories } = createTestSessionServices(
      { workspaceRoot },
      { now: () => committedAt },
    );
    const { pathResolver, sessionPathResolver, sessionTreeRepository, storageService, now } =
      repositories.sessionRepository;
    let journal;
    t.after(async () => {
      if (journal) await journal.close();
    });
    const access =
      acquisition === "owned"
        ? partitionReaderAccess
        : createPartitionSessionReaderAccess({
            withJournalRemoval: () => assert.fail("Unexpected journal removal"),
            acquireJournal(scope) {
              assert.equal(scope.sessionId, sessionId);
              return borrowFixtureJournal(journal);
            },
          });
    const repository = new FileSystemSessionRepository({
      pathResolver,
      sessionPathResolver,
      sessionTreeRepository,
      storageService,
      now,
      sessionReaderAccess: access,
    });
    const persistenceContext = repository.treePersistenceContext(userId, sessionId);
    const scope = await repository.placeSessionScope(
      userId,
      { sessionId, parentSessionId: "" },
      persistenceContext,
    );
    const options = { scope, persistenceContext };
    assert.equal(await repository.recoverSessionPlacement(userId, sessionId, options), null);
    if (acquisition === "borrowed") {
      journal = await PartitionJournal.create({
        root: scope.sessionDir,
        durableAncestor: workspaceRoot,
        sessionId,
        limits: journalTestLimits({ retentionRecords: 1 }),
        publication: "collections",
      });
      assert.equal(await repository.recoverSessionPlacement(userId, sessionId, options), null);
    }
    const register = repository.commitSessionPlacement.bind(repository);
    const failure = new Error("placement publication failed");
    repository.commitSessionPlacement = async () => {
      throw failure;
    };
    await assert.rejects(
      repository.createStoredSession(
        userId,
        repository.createInitialSession({ sessionId, parentSessionId: "", caller: "user" }),
        { sessionId, ...options },
      ),
      (error) => error === failure,
    );
    const headPath = join(scope.sessionDir, PARTITION_JOURNAL_HEAD_FILE);
    const before = await readFile(headPath);
    await assert.rejects(
      repository.recoverSessionPlacement(userId, sessionId, options),
      (error) => error === failure,
    );
    assert.deepEqual(await readFile(headPath), before);
    if (journal) {
      const releaseFailure = new Error("snapshot release failed during placement recovery");
      let fault;
      repository.commitSessionPlacement = async () => {
        fault = t.mock.method(journal, "releaseSnapshot", async () => {
          throw releaseFailure;
        });
        throw failure;
      };
      try {
        await assert.rejects(
          repository.recoverSessionPlacement(userId, sessionId, options),
          (error) => {
            assert.equal(error.cause, failure);
            assert.equal(error.errors[0], failure);
            assert.equal(error.errors[1].code, "SESSION_SNAPSHOT_RELEASE_UNCERTAIN");
            assert.equal(error.errors[1].cause, releaseFailure);
            return true;
          },
        );
      } finally {
        fault?.mock.restore();
      }
      await using reopened = await access.open({
        sessionId,
        sessionDir: scope.sessionDir,
        parentSessionId: "",
      });
      assert.equal((await reopened.readMetadata()).sessionId, sessionId);
    }
    repository.commitSessionPlacement = register;
    if (journal) {
      await journal.close();
      journal = await PartitionJournal.open({ root: scope.sessionDir, sessionId });
    }
    {
      await using recovered = await repository.recoverSessionPlacement(userId, sessionId, options);
      assert.equal((await recovered.readMetadata()).sessionId, sessionId);
      assert.deepEqual((await recovered.readMessagePage()).records, []);
    }
    {
      await using reader = await repository.requireSessionReader(userId, sessionId, {
        persistenceContext,
      });
      assert.equal((await reader.readMetadata()).parentSessionId, "");
    }
    assert.deepEqual(await readFile(headPath), before);
    await assert.rejects(
      repository.recoverSessionPlacement(userId, sessionId, {
        ...options,
        scope: { ...scope, resolvedParentSessionId: "foreign" },
      }),
      { code: "SESSION_SCOPE_IDENTITY_CONFLICT" },
    );
    for (const file of ["head.json", "format.json"])
      await assert.rejects(stat(join(scope.sessionDir, file)), { code: "ENOENT" });
  });
}
