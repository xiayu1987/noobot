/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { AttachmentService } from "../../src/artifacts/index.js";
import { createSessionServices } from "../../src/session/index.js";
import { TEST_SCOPED_SESSION_ROOTS } from "./scoped-session-roots.js";

export function createTestSessionServices(globalConfig, options = {}) {
  return createSessionServices(globalConfig, {
    now: testWallClock,
    scopedSessionRoots: TEST_SCOPED_SESSION_ROOTS,
    ...options,
    attachmentService: new AttachmentService(globalConfig),
  });
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

export async function commitTestSessionChanges(runtime, { userId, sessionId, changes }) {
  const repository = runtime.repositories.sessionRepository;
  const persistenceContext = repository.treePersistenceContext(userId, sessionId);
  await using reader = await repository.requireSessionReader(userId, sessionId, {
    persistenceContext,
  });
  return await repository.commitChanges(userId, sessionId, {
    persistenceContext,
    expectedGeneration: reader.generation,
    operationId: randomUUID(),
    committedAt: repository.now(),
    changes,
  });
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
