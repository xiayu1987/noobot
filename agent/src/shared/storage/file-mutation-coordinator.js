/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { filePath as path } from "@noobot/path-resolver";
import { runBestEffort } from "@noobot/shared/best-effort";
import { fsMkdir, fsOpen, fsReadFile, fsReaddir, fsRename, fsRm, fsStat } from "./fs-adapter.js";

const WAITER_TICKET_WIDTH = 16;

function heartbeatInterval(staleMs) {
  return Math.max(1, Math.floor(staleMs / 3));
}

function isOwnerProcessAlive(ownerToken) {
  const match = /^(\d+):/.exec(String(ownerToken || ""));
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function readLockOwner(lockPath) {
  const lockStat = await fsStat(lockPath);
  const ownerPath = lockStat.isDirectory() ? path.join(lockPath, "owner") : lockPath;
  return fsReadFile(ownerPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
}

async function cleanupBestEffort(operation, operationName, lockPath) {
  return runBestEffort(operation, {
    operationName,
    context: { lockPath },
  });
}

function waiterNames(lockPath) {
  const lockName = path.basename(lockPath);
  return {
    choosingPrefix: `${lockName}.wait-choosing-`,
    settledPrefix: `${lockName}.wait-`,
  };
}

function parseWaiterTicket(name, settledPrefix) {
  if (!name.startsWith(settledPrefix) || name.startsWith(`${settledPrefix}choosing-`)) return null;
  const separator = name.indexOf("-", settledPrefix.length);
  if (separator < 0) return null;
  const ticketText = name.slice(settledPrefix.length, separator);
  if (!/^\d+$/.test(ticketText)) return null;
  const ticket = Number(ticketText);
  return Number.isSafeInteger(ticket) ? ticket : null;
}

function waiterOwnerToken(name, ownerToken) {
  if (ownerToken) return ownerToken;
  const match = /-(\d+)-[0-9a-f-]+$/i.exec(name);
  return match ? `${match[1]}:` : "";
}

async function listLiveWaiters(lockPath, staleMs) {
  const parent = path.dirname(lockPath);
  const { choosingPrefix, settledPrefix } = waiterNames(lockPath);
  const names = await fsReaddir(parent).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const live = [];
  for (const name of names) {
    const ticket = parseWaiterTicket(name, settledPrefix);
    const choosing = name.startsWith(choosingPrefix);
    if (!choosing && ticket === null) continue;
    const waiterPath = path.join(parent, name);
    try {
      const waiterStat = await fsStat(waiterPath);
      if (Date.now() - waiterStat.mtimeMs > staleMs) {
        const storedOwner = await fsReadFile(waiterPath, "utf8").catch(() => "");
        if (!isOwnerProcessAlive(waiterOwnerToken(name, storedOwner))) {
          await fsRm(waiterPath, { force: true });
          continue;
        }
      }
      live.push({ name, path: waiterPath, choosing, ticket });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return live;
}

async function createWaiter(lockPath, staleMs, ownerId, ownerToken) {
  const parent = path.dirname(lockPath);
  const { choosingPrefix, settledPrefix } = waiterNames(lockPath);
  const choosingPath = path.join(parent, `${choosingPrefix}${ownerId}`);
  const choosingHandle = await fsOpen(choosingPath, "wx");
  try {
    await choosingHandle.writeFile(ownerToken, "utf8");
  } finally {
    await choosingHandle.close();
  }

  try {
    const waiters = await listLiveWaiters(lockPath, staleMs);
    const maxTicket = waiters.reduce(
      (current, waiter) => (waiter.ticket === null ? current : Math.max(current, waiter.ticket)),
      0,
    );
    const ticket = maxTicket + 1;
    if (!Number.isSafeInteger(ticket)) throw new Error("file mutation waiter ticket overflow");
    const ticketText = String(ticket).padStart(WAITER_TICKET_WIDTH, "0");
    const waiterPath = path.join(parent, `${settledPrefix}${ticketText}-${ownerId}`);
    const waiterHandle = await fsOpen(waiterPath, "wx");
    try {
      await waiterHandle.writeFile(ownerToken, "utf8");
    } catch (error) {
      await cleanupBestEffort(
        () => waiterHandle.close(),
        "fileMutation.closeIncompleteWaiter",
        lockPath,
      );
      await cleanupBestEffort(
        () => fsRm(waiterPath, { force: true }),
        "fileMutation.removeIncompleteWaiter",
        lockPath,
      );
      throw error;
    }
    await fsRm(choosingPath, { force: true });
    return { name: path.basename(waiterPath), path: waiterPath, handle: waiterHandle };
  } catch (error) {
    await cleanupBestEffort(
      () => fsRm(choosingPath, { force: true }),
      "fileMutation.removeChoosingWaiter",
      lockPath,
    );
    throw error;
  }
}

async function isElectedWaiter(lockPath, staleMs, waiterName) {
  const waiters = await listLiveWaiters(lockPath, staleMs);
  if (waiters.some((waiter) => waiter.choosing)) return false;
  const settled = waiters
    .filter((waiter) => waiter.ticket !== null)
    .sort((left, right) => left.ticket - right.ticket || left.name.localeCompare(right.name));
  return settled[0]?.name === waiterName;
}

async function statLock(lockPath) {
  const lockStat = await fsStat(lockPath);
  if (!lockStat.isDirectory()) return lockStat;
  return fsStat(path.join(lockPath, "owner")).catch((error) => {
    if (error?.code === "ENOENT") return lockStat;
    throw error;
  });
}

async function statAfterExclusiveCreateFailure(lockPath, createError) {
  try {
    return await statLock(lockPath);
  } catch (statError) {
    if (statError?.code !== "ENOENT") throw statError;
    if (createError?.code === "EEXIST") return null;
    throw createError;
  }
}

async function reclaimStaleLock(lockPath) {
  const stalePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await fsRename(lockPath, stalePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }
  await fsRm(stalePath, { recursive: true, force: true });
  return true;
}

export class FileMutationCoordinator {
  constructor({
    timeoutMs = 30000,
    staleMs = 60000,
    pollMs = 10,
    timeoutMessage = "file mutation lock timeout",
    timeoutErrorCode = "FILE_MUTATION_BUSY",
    operationName = "fileMutation.refreshLock",
  } = {}) {
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 30000);
    this.staleMs = Math.max(1, Number(staleMs) || 60000);
    this.pollMs = Math.max(1, Number(pollMs) || 10);
    this.timeoutMessage = String(timeoutMessage || "file mutation lock timeout");
    this.timeoutErrorCode = String(timeoutErrorCode || "FILE_MUTATION_BUSY");
    this.operationName = String(operationName || "fileMutation.refreshLock");
    this.asyncHeldLocks = new AsyncLocalStorage();
  }

  async run(lockPath, operation) {
    const key = path.resolve(lockPath);
    const heldLocks = this.asyncHeldLocks.getStore();
    const held = heldLocks?.get(key);
    if (held) {
      held.depth += 1;
      try {
        return await operation();
      } finally {
        held.depth -= 1;
      }
    }
    const deadline = Date.now() + this.timeoutMs;
    const ownerUuid = randomUUID();
    const ownerId = `${process.pid}-${ownerUuid}`;
    const ownerToken = `${process.pid}:${ownerUuid}`;
    await fsMkdir(path.dirname(key), { recursive: true });
    const waiter = await createWaiter(key, this.staleMs, ownerId, ownerToken);
    const waiterHeartbeat = setInterval(() => {
      void runBestEffort(() => waiter.handle.utimes(new Date(), new Date()), {
        operationName: this.operationName,
        context: { lockPath: key, phase: "waiting" },
      });
    }, heartbeatInterval(this.staleMs));
    waiterHeartbeat.unref?.();
    let lockHandle = null;
    try {
      while (true) {
        if (await isElectedWaiter(key, this.staleMs, waiter.name)) {
          try {
            lockHandle = await fsOpen(key, "wx");
            await lockHandle.writeFile(ownerToken, "utf8");
            break;
          } catch (error) {
            if (lockHandle) {
              await cleanupBestEffort(
                () => lockHandle.close(),
                "fileMutation.closeIncompleteLock",
                key,
              );
              lockHandle = null;
              await cleanupBestEffort(
                () => fsRm(key, { force: true }),
                "fileMutation.removeIncompleteLock",
                key,
              );
            }
            try {
              const current = await statAfterExclusiveCreateFailure(key, error);
              if (!current) continue;
              if (Date.now() - current.mtimeMs > this.staleMs) {
                const currentOwner = await readLockOwner(key);
                if (!isOwnerProcessAlive(currentOwner)) {
                  await reclaimStaleLock(key);
                  continue;
                }
              }
            } catch (statError) {
              if (statError?.code === "ENOENT") continue;
              throw statError;
            }
          }
        }
        if (Date.now() >= deadline) {
          const failure = new Error(this.timeoutMessage);
          failure.statusCode = 409;
          failure.errorCode = this.timeoutErrorCode;
          throw failure;
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      }
    } finally {
      clearInterval(waiterHeartbeat);
      await cleanupBestEffort(() => waiter.handle.close(), "fileMutation.closeWaiter", key);
      await cleanupBestEffort(
        () => fsRm(waiter.path, { force: true }),
        "fileMutation.removeWaiter",
        key,
      );
    }
    const heartbeat = setInterval(() => {
      void runBestEffort(() => lockHandle.utimes(new Date(), new Date()), {
        operationName: this.operationName,
        context: { lockPath: key },
      });
    }, heartbeatInterval(this.staleMs));
    heartbeat.unref?.();
    const nextHeldLocks = new Map(heldLocks || []);
    nextHeldLocks.set(key, { depth: 1 });
    try {
      return await this.asyncHeldLocks.run(nextHeldLocks, operation);
    } finally {
      clearInterval(heartbeat);
      await cleanupBestEffort(() => lockHandle.close(), "fileMutation.closeLock", key);
      const currentOwner = await fsReadFile(key, "utf8").catch(() => "");
      if (currentOwner === ownerToken) await fsRm(key, { force: true });
    }
  }
}
