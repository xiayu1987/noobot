/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentService } from "../../src/artifacts/index.js";
import { createPartitionSessionServices, createSessionFacade } from "../../src/session/index.js";
import { journalTestLimits } from "./partition-journal-cases.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./scoped-session-roots.js";
import { initializeUserWorkspace } from "./user-workspace.js";

export async function partitionRepositoryPerformanceFixture(t) {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const workspaceRoot = await mkdtemp(join(tmpdir(), "partition-repository-performance-"));
  let services;
  t.after(async () => {
    if (services) await services.runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  await initializeUserWorkspace(workspaceRoot, "u1");
  const journalLimits = journalTestLimits({
    partitionBytes: 512 * 1024,
    transactionBytes: 128 * 1024,
    queueBytes: 512 * 1024,
    batchBytes: 128 * 1024,
    receiptBytes: 128 * 1024,
    entityProjectionBytes: 512 * 1024,
    pageBytes: 128 * 1024,
    pageRecords: 32,
    quotaBytes: 256 * 1024 * 1024,
  });
  const open = () => {
    const config = { workspaceRoot };
    const runtime = createPartitionSessionServices(config, {
      now: () => timestamp,
      attachmentService: new AttachmentService(config),
      scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
      journalLimits,
      maxJournals: 1,
    });
    const repository = runtime.repositories.sessionRepository;
    return {
      runtime,
      session: createSessionFacade(runtime),
      repository,
      persistenceContext: repository.treePersistenceContext("u1", "s1"),
    };
  };
  services = open();
  await services.session.createSession({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    caller: "user",
    persistenceScope: null,
  });
  const scope = await services.repository.requireSessionScope(
    "u1",
    "s1",
    services.persistenceContext,
  );
  let operation = 0;
  const prepareWithReader = (reader, changes) =>
    reader.prepareRequest({
      operationId: `performance-${++operation}`,
      committedAt: timestamp,
      changes,
    });
  return {
    get services() {
      return services;
    },
    scope,
    async reopen() {
      await services.runtime.close();
      services = open();
    },
    commit(changes) {
      const { repository, persistenceContext } = services;
      return repository.withSessionReader(
        "u1",
        "s1",
        async ({ reader, commitChanges }) =>
          commitChanges(await prepareWithReader(reader, changes)),
        { persistenceContext },
      );
    },
  };
}
