/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireImmutableCleanupPlanId } from "@noobot/session-protocol/immutable-storage";
import { resolveSessionArtifactMutationLock } from "../session-artifact-files.js";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";

export function resolveImmutableCleanupPlanMutationLock(sessionDir, planId) {
  const id = requireImmutableCleanupPlanId(planId);
  return `${resolveSessionArtifactMutationLock(sessionDir)}.cleanup-${id}`;
}

export function withImmutableCleanupPlanMutation(sessionDir, planId, run) {
  return sessionMutationCoordinator.run(
    resolveImmutableCleanupPlanMutationLock(sessionDir, planId),
    run,
  );
}
