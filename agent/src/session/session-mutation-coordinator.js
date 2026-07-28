/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { filePath as path } from "../shared/utils/path-resolver.js";
import { fsMkdir, fsReadFile, fsRm, fsStat, fsWriteFile } from "../shared/storage/fs-adapter.js";

export class SessionMutationCoordinator {
  constructor({ timeoutMs = 30000, staleMs = 60000, pollMs = 10 } = {}) {
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 30000);
    this.staleMs = Math.max(1, Number(staleMs) || 60000);
    this.pollMs = Math.max(1, Number(pollMs) || 10);
    this.asyncHeldLocks = new AsyncLocalStorage();
  }

  async run(lockDir, operation) {
    const key = path.resolve(lockDir);
    const heldLocks = this.asyncHeldLocks.getStore();
    const held = heldLocks?.get(key);
    if (held) {
      held.depth += 1;
      try { return await operation(); } finally { held.depth -= 1; }
    }
    const deadline = Date.now() + this.timeoutMs;
    const ownerFile = path.join(key, "owner");
    const ownerToken = `${process.pid}:${randomUUID()}`;
    await fsMkdir(path.dirname(key), { recursive: true });
    while (true) {
      try {
        await fsMkdir(key);
        await fsWriteFile(ownerFile, ownerToken, "utf8");
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          const current = await fsStat(ownerFile).catch(() => fsStat(key));
          if (Date.now() - current.mtimeMs > this.staleMs) {
            await fsRm(key, { recursive: true, force: true });
            continue;
          }
        } catch (statError) {
          if (statError?.code === "ENOENT") continue;
          throw statError;
        }
        if (Date.now() >= deadline) {
          const failure = new Error("session mutation lock timeout");
          failure.statusCode = 409;
          failure.errorCode = "SESSION_MUTATION_BUSY";
          throw failure;
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      }
    }
    const heartbeat = setInterval(() => {
      void fsWriteFile(ownerFile, ownerToken, "utf8").catch(() => {});
    }, Math.max(1000, Math.floor(this.staleMs / 3)));
    heartbeat.unref?.();
    const nextHeldLocks = new Map(heldLocks || []);
    nextHeldLocks.set(key, { depth: 1 });
    try { return await this.asyncHeldLocks.run(nextHeldLocks, operation); }
    finally {
      clearInterval(heartbeat);
      const currentOwner = await fsReadFile(ownerFile, "utf8").catch(() => "");
      if (currentOwner === ownerToken) await fsRm(key, { recursive: true, force: true });
    }
  }
}

export const sessionMutationCoordinator = new SessionMutationCoordinator();
