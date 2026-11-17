/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import {
  SESSION_ARTIFACT_PREDECESSOR,
  writeSessionArtifact,
} from "../../src/session/session-artifact-store.js";

export async function writeLegacySessionFixture(
  repository,
  userId,
  session,
  { persistenceContext },
) {
  return repository.withSessionPlacementMutation(
    userId,
    { sessionId: session.sessionId, parentSessionId: session.parentSessionId },
    async (scope) => {
      for (const file of [scope.sessionFile, path.join(scope.sessionDir, "head.json")])
        assert.equal(
          await repository.storageService.exists(file),
          false,
          `Fixture already exists: ${file}`,
        );
      const { session: payload } = await writeSessionArtifact({
        storageService: repository.storageService,
        sessionDir: scope.sessionDir,
        sessionPayload: session,
        atomic: true,
        predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
      });
      await repository.commitSessionPlacement(userId, payload, persistenceContext);
      return scope;
    },
    { persistenceContext },
  );
}
