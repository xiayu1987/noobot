/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { restoreSessionCommitRequest } from "@noobot/session-protocol/session-changes";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { PartitionJournalOwner } from "../../src/session/partition-storage/partition-journal-owner.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";
import { createTestSessionServices } from "../helpers/session-services.js";
import { committedAt } from "./partition-session-messages.test-helpers.js";

export function createJournalOwner(workspaceRoot, limits) {
  return new PartitionJournalOwner({
    durableAncestor: workspaceRoot,
    limits: journalTestLimits(limits),
    maxJournals: 1,
  });
}

export function createRepository({ workspaceRoot, scope, owner }) {
  const { repositories } = createTestSessionServices(
    { workspaceRoot },
    {
      now: () => committedAt,
      sessionReaderAccess: createPartitionSessionReaderAccess({
        withJournalRemoval: owner.withRemoval.bind(owner),
        acquireJournal({ sessionDir, sessionId, parentSessionId }, options) {
          assert.deepEqual({ sessionDir, sessionId, parentSessionId }, scope);
          return owner.acquire(scope, options);
        },
      }),
    },
  );
  return repositories.sessionRepository;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { workspaceRoot, scope, userId, serialized } = JSON.parse(process.argv[2]);
  const { sessionId } = scope;
  await using owner = createJournalOwner(workspaceRoot);
  const repository = createRepository({ workspaceRoot, scope, owner });
  const persistenceContext = repository.treePersistenceContext(userId, sessionId);
  const replay = await repository.withSessionReader(
    userId,
    sessionId,
    ({ commitChanges }) => commitChanges(restoreSessionCommitRequest(serialized)),
    { persistenceContext },
  );
  process.stdout.write(JSON.stringify(replay));
}
