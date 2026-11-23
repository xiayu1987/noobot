/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { filePath as path } from "@noobot/path-resolver";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { acquireDescriptorLock } from "@noobot/platform-compatibility/descriptor-lock";
import { createSessionMutationBusyError } from "@noobot/session-protocol";
import { withStorageCleanup } from "../shared/storage/durable-file.js";
import { fsMkdir, fsOpen } from "../shared/storage/fs-adapter.js";

function configuredTiming() {
  const { lockTimeoutMs: timeoutMs, lockPollIntervalMs: pollMs } = TIME_THRESHOLDS.fileMutation;
  return { timeoutMs, pollMs };
}

function timeoutError() {
  return createSessionMutationBusyError("session mutation lock timeout");
}

export class SessionMutationCoordinator {
  constructor({ readTiming = configuredTiming } = {}) {
    this.readTiming = readTiming;
    this.asyncHeldLocks = new AsyncLocalStorage();
    this.localQueues = new Map();
  }

  async waitForLocalTurn(previous, deadline) {
    const expired = Promise.withResolvers();
    const timer = setTimeout(
      () => expired.reject(timeoutError()),
      Math.max(0, deadline - performance.now()),
    );
    try {
      await Promise.race([previous, expired.promise]);
      if (performance.now() >= deadline) throw timeoutError();
    } finally {
      clearTimeout(timer);
    }
  }

  async run(lockPath, operation) {
    const key = path.resolve(lockPath);
    const held = this.asyncHeldLocks.getStore();
    if (held?.get(key)?.active) return operation();
    const { timeoutMs, pollMs } = this.readTiming();
    const deadline = performance.now() + timeoutMs;
    const previous = this.localQueues.get(key) ?? Promise.resolve();
    const released = Promise.withResolvers();
    const tail = previous.then(() => released.promise);
    this.localQueues.set(key, tail);
    try {
      await this.waitForLocalTurn(previous, deadline);
      return await this.runExclusive({ key, deadline, pollMs, held, operation });
    } finally {
      released.resolve();
      void tail.then(() => {
        if (this.localQueues.get(key) === tail) this.localQueues.delete(key);
      });
    }
  }

  async runExclusive({ key, deadline, pollMs, held, operation }) {
    await fsMkdir(path.dirname(key), { recursive: true });
    const handle = await fsOpen(key, "a+", 0o600);
    const entry = { active: false };
    return withStorageCleanup(
      async () => {
        await acquireDescriptorLock(handle, { deadline, pollMs, timeoutError });
        entry.active = true;
        return this.asyncHeldLocks.run(new Map(held).set(key, entry), operation);
      },
      () => {
        entry.active = false;
        return handle.close();
      },
    );
  }
}

export const sessionMutationCoordinator = new SessionMutationCoordinator();
