/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { initializePartitionReaderFixture } from "./partition-reader-fixture.js";

export async function seedPartitionSessionFixture(
  repository,
  userId,
  session,
  { persistenceContext },
) {
  return repository.withSessionPlacementMutation(
    userId,
    { sessionId: session.sessionId, parentSessionId: session.parentSessionId },
    async (scope) => {
      const { session: payload } = await initializePartitionReaderFixture({
        sessionDir: scope.sessionDir,
        session,
      });
      await repository.commitSessionPlacement(userId, payload, persistenceContext);
      return scope;
    },
    { persistenceContext },
  );
}
