/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { filePath as path } from "@noobot/path-resolver";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  createTestSessionServices,
  provisionTestSession,
  submitTestSessionRequest,
} from "./session-services.js";
import { initializeUserWorkspace } from "./user-workspace.js";
import { migrateSessionImmutableStorage } from "../../src/workspace-lifecycle/session-immutable-storage-upgrade.js";

import { timestamp } from "./session-repository-message.js";

export async function createImmutableRepositoryFixture(t) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "immutable-repository-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initializeUserWorkspace(workspaceRoot, "u1");
  const runtime = createTestSessionServices({ workspaceRoot }, { now: () => timestamp });
  await provisionTestSession(runtime, {
    userId: "u1",
    sessionId: "s1",
    caller: SESSION_CALLER.USER,
  });
  const repository = runtime.repositories.sessionRepository;
  const persistenceContext = repository.treePersistenceContext("u1", "s1");
  const scope = await repository.requireSessionScope("u1", "s1", persistenceContext);
  await migrateSessionImmutableStorage({
    storageService: repository.storageService,
    sessionDir: scope.sessionDir,
  });
  let operation = 0;
  const prepareWithReader = (reader, changes) =>
    reader.prepareRequest({
      operationId: `repository-${++operation}`,
      committedAt: timestamp,
      changes,
    });
  const prepare = async (changes) => {
    await using reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    return await prepareWithReader(reader, changes);
  };
  const submit = (request) =>
    submitTestSessionRequest(repository, "u1", "s1", request, persistenceContext);
  const commit = (changes) =>
    repository.withSessionReader(
      "u1",
      "s1",
      async ({ reader, commitChanges }) => commitChanges(await prepareWithReader(reader, changes)),
      { persistenceContext },
    );
  return { services: { repository, persistenceContext }, scope, commit, prepare, submit };
}
