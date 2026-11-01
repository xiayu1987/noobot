/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { filePath as path } from "@noobot/path-resolver";
import { runBestEffort } from "@noobot/shared/best-effort";
import { requirePositiveInteger, text } from "@noobot/shared/value";
import { fsMkdir, fsOpen, fsReadFile, fsReaddir, fsRename, fsRm, fsStat } from "./fs-adapter.js";

const WAITER_TICKET_WIDTH = 16;
const TRANSIENT_EXCLUSIVE_CREATE_WINDOW_MS = 1000;
const TRANSIENT_EXCLUSIVE_CREATE_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function isTransientExclusiveCreateFailure(error) {
  return TRANSIENT_EXCLUSIVE_CREATE_CODES.has(String(error?.code || ""));
}

function heartbeatInterval(staleMs) {
  return Math.max(1, Math.floor(staleMs / 3));
}

export function isOwnerProcessAlive(ownerToken) {
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

function readFileIfPresent(filePath) {
  return fsReadFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
}

async function inspectWaiter(waiterPath, name, staleMs) {
  const waiterStat = await fsStat(waiterPath);
  const storedOwner = await readFileIfPresent(waiterPath);
  const ownerToken = waiterOwnerToken(name, storedOwner);
  if (isOwnerProcessAlive(ownerToken)) return waiterStat;
  if (!/^\d+:/.test(ownerToken) && Date.now() - waiterStat.mtimeMs <= staleMs) return waiterStat;
  await fsRm(waiterPath, { force: true });
  return null;
}

async function inspectWaiterIfPresent(waiterPath, name, staleMs) {
  try {
    return await inspectWaiter(waiterPath, name, staleMs);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
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
    if (await inspectWaiterIfPresent(waiterPath, name, staleMs))
      live.push({ name, path: waiterPath, choosing, ticket });
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

async function statAfterExclusiveCreateFailure(lockPath, createError) {
  try {
    return await fsStat(lockPath);
  } catch (statError) {
    if (statError?.code !== "ENOENT") throw statError;
    if (createError?.code === "EEXIST") return null;
    if (isTransientExclusiveCreateFailure(createError)) return null;
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
  await fsRm(stalePath, { force: true });
  return true;
}

const COORDINATOR_OWNER = "FileMutationCoordinator";

function requireText(name, value) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${COORDINATOR_OWNER} requires non-empty ${name}`);
  return normalized;
}

function startHeartbeat(handle, staleMs, operationName, context) {
  const timer = setInterval(() => {
    void runBestEffort(() => handle.utimes(new Date(), new Date()), { operationName, context });
  }, heartbeatInterval(staleMs));
  timer.unref?.();
  return timer;
}

async function openLock(lockPath, ownerToken) {
  const handle = await fsOpen(lockPath, "wx");
  try {
    await handle.writeFile(ownerToken, "utf8");
    return handle;
  } catch (error) {
    await cleanupBestEffort(() => handle.close(), "fileMutation.closeIncompleteLock", lockPath);
    await cleanupBestEffort(
      () => fsRm(lockPath, { force: true }),
      "fileMutation.removeIncompleteLock",
      lockPath,
    );
    throw error;
  }
}

async function releaseOwnedLock(lockPath, ownerToken) {
  if ((await readFileIfPresent(lockPath)) !== ownerToken) return;
  await fsRm(lockPath, { force: true });
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
    this.timeoutMs = requirePositiveInteger(COORDINATOR_OWNER, "timeoutMs", timeoutMs);
    this.staleMs = requirePositiveInteger(COORDINATOR_OWNER, "staleMs", staleMs);
    this.pollMs = requirePositiveInteger(COORDINATOR_OWNER, "pollMs", pollMs);
    this.timeoutMessage = requireText("timeoutMessage", timeoutMessage);
    this.timeoutErrorCode = requireText("timeoutErrorCode", timeoutErrorCode);
    this.operationName = requireText("operationName", operationName);
    this.transientCreateWindowMs = Math.max(
      this.pollMs,
      Math.min(this.staleMs, TRANSIENT_EXCLUSIVE_CREATE_WINDOW_MS),
    );
    this.asyncHeldLocks = new AsyncLocalStorage();
  }

  async run(lockPath, operation) {
    const key = path.resolve(lockPath);
    const heldLocks = this.asyncHeldLocks.getStore();
    if (heldLocks?.get(key)?.released === false) return operation();
    const deadline = Date.now() + this.timeoutMs;
    const ownerUuid = randomUUID();
    const owner = { id: `${process.pid}-${ownerUuid}`, token: `${process.pid}:${ownerUuid}` };
    const handle = await this.acquireAsWaiter(key, owner, deadline);
    return this.runHolding({ key, handle, ownerToken: owner.token }, operation);
  }

  async acquireAsWaiter(key, owner, deadline) {
    await fsMkdir(path.dirname(key), { recursive: true });
    const waiter = await createWaiter(key, this.staleMs, owner.id, owner.token);
    const heartbeat = startHeartbeat(waiter.handle, this.staleMs, this.operationName, {
      lockPath: key,
      phase: "waiting",
    });
    try {
      return await this.acquire(key, waiter.name, owner.token, deadline);
    } finally {
      clearInterval(heartbeat);
      await cleanupBestEffort(() => waiter.handle.close(), "fileMutation.closeWaiter", key);
      await cleanupBestEffort(
        () => fsRm(waiter.path, { force: true }),
        "fileMutation.removeWaiter",
        key,
      );
    }
  }

  async acquire(key, waiterName, ownerToken, deadline) {
    const contention = { transientSince: 0 };
    while (true) {
      const attempt = await this.tryAcquire(key, waiterName, ownerToken, contention);
      if (attempt.handle) return attempt.handle;
      if (attempt.retry) continue;
      if (Date.now() >= deadline) throw this.timeoutError();
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }

  async tryAcquire(key, waiterName, ownerToken, contention) {
    if (!(await isElectedWaiter(key, this.staleMs, waiterName))) return { retry: false };
    try {
      return { handle: await openLock(key, ownerToken) };
    } catch (error) {
      return { retry: await this.retryAfterCreateFailure(key, error, contention) };
    }
  }

  async retryAfterCreateFailure(key, error, contention) {
    try {
      return await this.resolveCreateFailure(key, error, contention);
    } catch (statError) {
      if (statError?.code === "ENOENT") return true;
      throw statError;
    }
  }

  async resolveCreateFailure(key, error, contention) {
    const current = await statAfterExclusiveCreateFailure(key, error);
    if (!current && !isTransientExclusiveCreateFailure(error)) return true;
    if (!current) {
      contention.transientSince ||= Date.now();
      if (Date.now() - contention.transientSince > this.transientCreateWindowMs) throw error;
      return true;
    }
    contention.transientSince = 0;
    const ownerToken = await readFileIfPresent(key);
    if (isOwnerProcessAlive(ownerToken)) return false;
    if (!/^\d+:/.test(ownerToken) && Date.now() - current.mtimeMs <= this.staleMs) return false;
    await reclaimStaleLock(key);
    return true;
  }

  async runHolding({ key, handle, ownerToken }, operation) {
    const heartbeat = startHeartbeat(handle, this.staleMs, this.operationName, {
      lockPath: key,
    });
    const heldEntry = { released: false };
    const nextHeldLocks = new Map(this.asyncHeldLocks.getStore());
    nextHeldLocks.set(key, heldEntry);
    try {
      return await this.asyncHeldLocks.run(nextHeldLocks, operation);
    } finally {
      heldEntry.released = true;
      clearInterval(heartbeat);
      await cleanupBestEffort(() => handle.close(), "fileMutation.closeLock", key);
      await cleanupBestEffort(
        () => releaseOwnedLock(key, ownerToken),
        "fileMutation.removeLock",
        key,
      );
    }
  }

  timeoutError() {
    const failure = new Error(this.timeoutMessage);
    failure.statusCode = 409;
    failure.code = this.timeoutErrorCode;
    return failure;
  }
}
