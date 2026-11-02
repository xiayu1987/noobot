/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isPlainObject } from "./value.js";
import {
  activateRuntimeParams,
  activeRuntimeParams,
  createDefaultRuntimeParamsDocument,
  validateRuntimeParamsDocument,
  validateRuntimeOverrides,
  runtimeParamsError,
  RUNTIME_PARAM_CATALOG,
  runtimeParamValue,
} from "./runtime-params.js";

export function readRuntimeParamsDocument(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return createDefaultRuntimeParamsDocument();
    throw error;
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    throw Object.assign(
      runtimeParamsError("INVALID_RUNTIME_PARAMS_DOCUMENT", `invalid JSON in ${filePath}`),
      { cause },
    );
  }
  return validateRuntimeParamsDocument(document);
}

export function initializeRuntimeParams(filePath) {
  if (!path.isAbsolute(filePath)) throw new TypeError("runtime params path must be absolute");
  const document = readRuntimeParamsDocument(filePath);
  activateRuntimeParams(document);
  return document;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

function lockCorrupted(lockFile, reason) {
  return runtimeParamsError(
    "RUNTIME_PARAMS_LOCK_CORRUPTED",
    `runtime parameter lock ${reason}: ${lockFile}`,
    500,
  );
}

function readLockOwner(lockFile) {
  const text = fs.readFileSync(lockFile, "utf8");
  const match = /^([1-9]\d*):([0-9a-f-]{36})$/.exec(text);
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw lockCorrupted(lockFile, "has no valid owner");
  return { pid: Number(match[1]), text };
}

function busyError(owner) {
  return runtimeParamsError(
    "RUNTIME_PARAMS_BUSY",
    `runtime parameter store is locked by process ${owner}`,
    409,
  );
}

function publishLock(candidate, lockPath) {
  try {
    fs.linkSync(candidate, lockPath);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return false;
  }
}

function restoreReplacedLock(claimed, lockPath) {
  try {
    fs.linkSync(claimed, lockPath);
  } catch (error) {
    if (error.code === "EEXIST") throw lockCorrupted(lockPath, "was replaced concurrently");
    throw error;
  } finally {
    fs.unlinkSync(claimed);
  }
}

function reclaimStaleLock(lockPath, owner) {
  const claimed = `${lockPath}.${randomUUID()}.stale`;
  try {
    fs.renameSync(lockPath, claimed);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const claimedOwner = readLockOwner(claimed);
  if (claimedOwner.text !== owner.text) {
    restoreReplacedLock(claimed, lockPath);
    throw busyError(claimedOwner.pid);
  }
  fs.unlinkSync(claimed);
  return true;
}

function acquireStoreLock(lockPath) {
  const record = `${process.pid}:${randomUUID()}`;
  const candidate = `${lockPath}.${randomUUID()}.owner`;
  fs.writeFileSync(candidate, record, { mode: 0o600, flag: "wx" });
  try {
    while (!publishLock(candidate, lockPath)) {
      const owner = readLockOwner(lockPath);
      if (isProcessAlive(owner.pid)) throw busyError(owner.pid);
      reclaimStaleLock(lockPath, owner);
    }
    return record;
  } finally {
    fs.unlinkSync(candidate);
  }
}

function releaseStoreLock(lockPath, record) {
  if (fs.readFileSync(lockPath, "utf8") !== record)
    throw lockCorrupted(lockPath, "is no longer owned by this writer");
  fs.unlinkSync(lockPath);
}

function withStoreLock(lockPath, work) {
  const record = acquireStoreLock(lockPath);
  let result;
  try {
    result = work();
  } catch (error) {
    try {
      releaseStoreLock(lockPath, record);
    } catch (releaseError) {
      releaseError.cause = error;
      throw releaseError;
    }
    throw error;
  }
  releaseStoreLock(lockPath, record);
  return result;
}

export function createRuntimeParamsStore(filePath, { active = activeRuntimeParams } = {}) {
  function read() {
    const saved = readRuntimeParamsDocument(filePath);
    const running = active();
    return {
      ok: true,
      schemaVersion: saved.schemaVersion,
      revision: saved.revision,
      activeRevision: running.revision,
      restartRequired: saved.revision !== running.revision,
      overrides: saved.overrides,
      catalog: RUNTIME_PARAM_CATALOG.map((definition) => ({
        ...definition,
        activeValue: runtimeParamValue(running, definition),
        savedValue: runtimeParamValue(saved, definition),
      })),
      lastChange: saved.history.at(-1) ?? null,
    };
  }

  function save(request, actor) {
    if (
      !isPlainObject(request) ||
      Object.keys(request).some((key) => !["revision", "overrides"].includes(key))
    ) {
      throw runtimeParamsError("INVALID_RUNTIME_PARAMS", "expected revision and overrides");
    }
    const { revision, overrides } = request;
    if (!actor) throw runtimeParamsError("RUNTIME_PARAMS_ACTOR_REQUIRED", "actor is required");
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw runtimeParamsError("INVALID_RUNTIME_PARAMS_REVISION", "revision is required");
    const validated = validateRuntimeOverrides(overrides);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    return withStoreLock(`${filePath}.lock`, () => {
      try {
        const previous = readRuntimeParamsDocument(filePath);
        if (previous.revision !== revision)
          throw runtimeParamsError(
            "RUNTIME_PARAMS_CONFLICT",
            "runtime parameters changed; reload before saving",
            409,
          );
        const changes = RUNTIME_PARAM_CATALOG.flatMap((definition) => {
          const before = runtimeParamValue(previous, definition);
          const after = runtimeParamValue({ overrides: validated }, definition);
          return before === after ? [] : [{ key: definition.key, before, after }];
        });
        if (!changes.length) return read();
        const next = validateRuntimeParamsDocument({
          schemaVersion: previous.schemaVersion,
          revision: revision + 1,
          overrides: validated,
          history: [
            ...previous.history,
            { revision: revision + 1, actor, at: new Date().toISOString(), changes },
          ],
        });
        fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
          mode: 0o600,
          flag: "wx",
        });
        const fd = fs.openSync(temporary, "r");
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(temporary, filePath);
        return read();
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    });
  }
  return { read, save };
}

function canonicalWritePath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return path.join(canonicalWritePath(path.dirname(filePath)), path.basename(filePath));
  }
}

export function assertRuntimeParamsFileWriteAllowed(filePath, protectedFile) {
  const target = canonicalWritePath(path.resolve(filePath));
  const protectedPath = canonicalWritePath(path.resolve(protectedFile));
  if (target === protectedPath || target.startsWith(`${protectedPath}.`)) {
    throw runtimeParamsError(
      "RUNTIME_PARAMS_MANAGED_FILE",
      "use the runtime parameters API to change this file",
      403,
    );
  }
}
