/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { filePath as path } from "@noobot/path-resolver";
import { runBestEffort } from "@noobot/shared/best-effort";
import { requireFunctionDependencies, requirePositiveInteger, text } from "@noobot/shared/value";
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

export function isHeartbeatFresh(lockStat, staleMs) {
  return Date.now() - lockStat.mtimeMs <= staleMs;
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

function readFileIfPresent(filePath) {
  return fsReadFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
}

async function inspectWaiter(waiterPath, staleMs) {
  const waiterStat = await fsStat(waiterPath);
  if (isHeartbeatFresh(waiterStat, staleMs)) return waiterStat;
  await fsRm(waiterPath, { force: true });
  return null;
}

async function inspectWaiterIfPresent(waiterPath, staleMs) {
  try {
    return await inspectWaiter(waiterPath, staleMs);
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
    if (await inspectWaiterIfPresent(waiterPath, staleMs))
      live.push({ name, path: waiterPath, choosing, ticket });
  }
  return live;
}

async function createWaiter(lockPath, staleMs, ownerToken) {
  const parent = path.dirname(lockPath);
  const { choosingPrefix, settledPrefix } = waiterNames(lockPath);
  const choosingPath = path.join(parent, `${choosingPrefix}${ownerToken}`);
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
    const waiterPath = path.join(parent, `${settledPrefix}${ticketText}-${ownerToken}`);
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

export function readConfiguredLockTiming() {
  const { lockTimeoutMs, lockStaleMs, lockPollIntervalMs } = TIME_THRESHOLDS.fileMutation;
  return { timeoutMs: lockTimeoutMs, staleMs: lockStaleMs, pollMs: lockPollIntervalMs };
}

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
    readTiming = readConfiguredLockTiming,
    timeoutMessage = "file mutation lock timeout",
    timeoutErrorCode = "FILE_MUTATION_BUSY",
    operationName = "fileMutation.refreshLock",
    ...unknownOptions
  } = {}) {
    const unknownKeys = Object.keys(unknownOptions);
    if (unknownKeys.length) {
      throw new TypeError(
        `${COORDINATOR_OWNER} received unknown options: ${unknownKeys.join(", ")}`,
      );
    }
    requireFunctionDependencies(COORDINATOR_OWNER, { readTiming });
    this.readTiming = readTiming;
    this.timeoutMessage = requireText("timeoutMessage", timeoutMessage);
    this.timeoutErrorCode = requireText("timeoutErrorCode", timeoutErrorCode);
    this.operationName = requireText("operationName", operationName);
    this.asyncHeldLocks = new AsyncLocalStorage();
  }

  lockTimingField(field) {
    return requirePositiveInteger(COORDINATOR_OWNER, field, this.readTiming()[field]);
  }

  get timeoutMs() {
    return this.lockTimingField("timeoutMs");
  }

  get staleMs() {
    return this.lockTimingField("staleMs");
  }

  get pollMs() {
    return this.lockTimingField("pollMs");
  }

  get transientCreateWindowMs() {
    return Math.max(this.pollMs, Math.min(this.staleMs, TRANSIENT_EXCLUSIVE_CREATE_WINDOW_MS));
  }

  async run(lockPath, operation) {
    const key = path.resolve(lockPath);
    const heldLocks = this.asyncHeldLocks.getStore();
    if (heldLocks?.get(key)?.released === false) return operation();
    const deadline = Date.now() + this.timeoutMs;
    const ownerToken = randomUUID();
    const handle = await this.acquireAsWaiter(key, ownerToken, deadline);
    return this.runHolding({ key, handle, ownerToken }, operation);
  }

  async acquireAsWaiter(key, ownerToken, deadline) {
    await fsMkdir(path.dirname(key), { recursive: true });
    const waiter = await createWaiter(key, this.staleMs, ownerToken);
    const heartbeat = startHeartbeat(waiter.handle, this.staleMs, this.operationName, {
      lockPath: key,
      phase: "waiting",
    });
    try {
      return await this.acquire(key, waiter.name, ownerToken, deadline);
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
    if (isHeartbeatFresh(current, this.staleMs)) return false;
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
