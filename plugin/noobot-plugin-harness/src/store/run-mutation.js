/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { withDescriptorLock } from "@noobot/platform-compatibility/descriptor-lock";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { readWorkspaceSessionDeletionState } from "@noobot/workspace-protocol/session-store";
import { WORKSPACE_LAYOUT, isWorkspacePathSegment } from "@noobot/workspace-protocol";
import { isPlainObject } from "@noobot/shared/value";
import { resolveHarnessRunsRelativePath } from "../core/constants.js";

export function harnessRunsDirectory(basePath) {
  return path.resolve(basePath, resolveHarnessRunsRelativePath());
}

export function manifestSessionIds(manifest) {
  const parentSessionId = manifest?.parentSessionId ?? "";
  if (
    !isPlainObject(manifest) ||
    !isWorkspacePathSegment(manifest.sessionId) ||
    (parentSessionId !== "" && !isWorkspacePathSegment(parentSessionId))
  ) {
    throw new TypeError("harness run requires valid session ownership");
  }
  return parentSessionId === "" ? [manifest.sessionId] : [manifest.sessionId, parentSessionId];
}

export async function withHarnessRunsMutation(basePath, operation, { signal } = {}) {
  const directory = path.dirname(harnessRunsDirectory(basePath));
  const { lockTimeoutMs, lockPollIntervalMs } = TIME_THRESHOLDS.fileMutation;
  await fs.mkdir(directory, { recursive: true });
  const handle = await fs.open(path.join(directory, ".runs-mutation.lock"), "a+", 0o600);
  return withDescriptorLock(
    handle,
    {
      deadline: performance.now() + lockTimeoutMs,
      pollMs: lockPollIntervalMs,
      signal,
      timeoutError: () =>
        Object.assign(new Error("Harness runs mutation lock timed out"), {
          code: "HARNESS_RUNS_BUSY",
        }),
    },
    operation,
  );
}

export async function findDeletedRunSession(run) {
  const { sessions } = await readWorkspaceSessionDeletionState({
    file: path.join(run.basePath, WORKSPACE_LAYOUT.SESSION_TOMBSTONE_FILE),
    readFile: fs.readFile,
  });
  return manifestSessionIds(run).find((id) => Object.hasOwn(sessions, id));
}
