/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { open } from "node:fs/promises";
import path from "node:path";
import { withDescriptorLock } from "@noobot/platform-compatibility/descriptor-lock";
import { createSessionMutationBusyError } from "@noobot/session-protocol/errors";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol/layout";
import { createWorkspaceNotInitializedError } from "@noobot/workspace-protocol/session-store";
import { text } from "@noobot/shared/value";

export function resolveSessionEventWorkspace({ workspaceRoot, userId }) {
  const root = text(workspaceRoot);
  const id = text(userId);
  if (!root || !id)
    throw new TypeError("workspace session location requires workspaceRoot and userId");
  return path.join(path.resolve(root), id);
}

async function openPublicationFence(workspacePath) {
  const file = path.join(workspacePath, WORKSPACE_LAYOUT.SESSION_EVENT_PUBLICATION_LOCK_FILE);
  try {
    return await open(file, "a+", 0o600);
  } catch (error) {
    if (error.code === "ENOENT")
      throw createWorkspaceNotInitializedError(
        path.join(workspacePath, WORKSPACE_LAYOUT.SESSION_TREE_FILE),
      );
    throw error;
  }
}

async function withPublication(workspacePath, shared, run) {
  const { lockTimeoutMs, lockPollIntervalMs } = TIME_THRESHOLDS.fileMutation;
  const handle = await openPublicationFence(workspacePath);
  return withDescriptorLock(
    handle,
    {
      deadline: performance.now() + lockTimeoutMs,
      pollMs: lockPollIntervalMs,
      shared,
      timeoutError: () => createSessionMutationBusyError("Session runtime events are in use"),
    },
    run,
  );
}

export function withSessionEventRetirement(workspacePath, run) {
  return withPublication(workspacePath, false, run);
}

export function withSessionEventPublications(workspaceRoot, records, run) {
  const workspaces = [
    ...new Set(
      records.map(({ userId }) => resolveSessionEventWorkspace({ workspaceRoot, userId })),
    ),
  ];
  const lockAt = (index) =>
    index === workspaces.length
      ? run()
      : withPublication(workspaces[index], true, () => lockAt(index + 1));
  return lockAt(0);
}
