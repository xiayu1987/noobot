/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { acquireDescriptorLock } from "@noobot/platform-compatibility/descriptor-lock";
import { fsMkdir, fsOpen } from "../shared/storage/fs-adapter.js";
import { withStorageCleanup } from "../shared/storage/durable-file.js";

function acquireWorkspaceStorageLock(workspaceRoot, { shared = true, signal } = {}) {
  return acquireWorkspaceLock(workspaceRoot, ".session-storage.lock", { shared, signal });
}

export { acquireWorkspaceStorageLock };

async function acquireWorkspaceLock(workspaceRoot, name, { shared, signal }) {
  signal?.throwIfAborted();
  await fsMkdir(workspaceRoot, { recursive: true });
  const handle = await fsOpen(path.join(workspaceRoot, name), "a+", 0o600);
  const { lockTimeoutMs, lockPollIntervalMs } = TIME_THRESHOLDS.fileMutation;
  try {
    await acquireDescriptorLock(handle, {
      deadline: performance.now() + lockTimeoutMs,
      pollMs: lockPollIntervalMs,
      shared,
      signal,
      timeoutError: () =>
        Object.assign(new Error("Workspace session storage is in use"), {
          code: "WORKSPACE_SESSION_STORAGE_BUSY",
        }),
    });
    return handle;
  } catch (error) {
    return withStorageCleanup(
      () => {
        throw error;
      },
      () => handle.close(),
    );
  }
}

export async function withExclusiveWorkspaceStorage({ base, startupStorage, signal }, operation) {
  if (startupStorage) return startupStorage.withExclusive(operation);
  const lock = await acquireWorkspaceStorageLock(path.dirname(base), { shared: false, signal });
  return withStorageCleanup(operation, () => lock.close());
}

export async function openStartupWorkspaceStorage(workspaceRoot, { signal } = {}) {
  let startup = await acquireWorkspaceLock(workspaceRoot, ".session-storage-startup.lock", {
    shared: false,
    signal,
  });
  let shared;
  async function releaseStartup() {
    await startup?.close();
    startup = undefined;
  }
  try {
    shared = await acquireWorkspaceStorageLock(workspaceRoot, { signal });
  } catch (error) {
    return withStorageCleanup(() => {
      throw error;
    }, releaseStartup);
  }
  function assertOpen() {
    if (!shared) throw new Error("Startup workspace storage lease is not held");
  }
  return Object.freeze({
    async withExclusive(operation) {
      assertOpen();
      if (!startup) throw new Error("Workspace startup preparation has finished");
      await shared.close();
      shared = undefined;
      return withStorageCleanup(
        async () => {
          const lock = await acquireWorkspaceStorageLock(workspaceRoot, { shared: false, signal });
          return withStorageCleanup(operation, () => lock.close());
        },
        async () => {
          if (!signal?.aborted)
            shared = await acquireWorkspaceStorageLock(workspaceRoot, { signal });
        },
      );
    },
    async finishStartup() {
      assertOpen();
      await releaseStartup();
    },
    async close() {
      await withStorageCleanup(async () => {
        await shared?.close();
        shared = undefined;
      }, releaseStartup);
    },
    assertOpen,
  });
}
