/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { SESSION_DELETION_STAGE } from "@noobot/workspace-protocol/session-tombstone";
import { AttachmentService } from "../../src/artifacts/index.js";
import { createPartitionSessionServices } from "../../src/session/index.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./scoped-session-roots.js";
import { journalTestLimits } from "./partition-journal-cases.js";

export function createTestPartitionSessionServices(globalConfig, options = {}) {
  return createPartitionSessionServices(globalConfig, {
    now: testWallClock,
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    journalLimits: journalTestLimits({ transactionBytes: 16 * 1024 }),
    maxJournals: 4,
    ...options,
    attachmentService: new AttachmentService(globalConfig),
  });
}

export function createTestSessionServices(globalConfig, options = {}) {
  return createTestPartitionSessionServices(globalConfig, options);
}

export async function executeEmptySessionCleanup({ stage }) {
  switch (stage) {
    case SESSION_DELETION_STAGE.PLAN_PLUGINS:
      return [];
    case SESSION_DELETION_STAGE.PLUGINS:
    case SESSION_DELETION_STAGE.ATTACHMENTS:
    case SESSION_DELETION_STAGE.SHORT_MEMORY:
      return;
    default:
      throw new TypeError(`Unexpected cleanup stage: ${stage}`);
  }
}

export async function persistSessionDeletionMarkers(repository, userId, sessionIds) {
  await repository._updateSessionTombstones(userId, (state) =>
    repository._addSessionTombstones(state, sessionIds, userId),
  );
  await repository.revokeSessionReads(userId, new Set(sessionIds), new Set());
}

export function testWallClock() {
  return new Date().toISOString();
}

export function withTreeContext(runtime, payload) {
  return {
    ...payload,
    persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
      payload.userId,
      payload.sessionId,
    ),
  };
}

export function submitTestSessionRequest(
  repository,
  userId,
  sessionId,
  request,
  persistenceContext,
) {
  return repository.withSessionReader(
    userId,
    sessionId,
    ({ commitChanges }) => commitChanges(request),
    { persistenceContext },
  );
}

export async function commitTestSessionChanges(runtime, { userId, sessionId, changes }) {
  const repository = runtime.repositories.sessionRepository;
  const persistenceContext = repository.treePersistenceContext(userId, sessionId);
  return repository.withSessionReader(
    userId,
    sessionId,
    async ({ reader, commitChanges }) =>
      commitChanges(
        await reader.prepareRequest({
          operationId: randomUUID(),
          committedAt: repository.now(),
          changes,
        }),
      ),
    { persistenceContext },
  );
}

export function provisionTestSession(runtime, { userId, sessionId, parentSessionId = "", caller }) {
  const sessionRepository = runtime.repositories.sessionRepository;
  return sessionRepository.ensureSession({
    userId,
    sessionId,
    parentSessionId,
    caller,
    persistenceContext: sessionRepository.treePersistenceContext(userId, sessionId),
  });
}
