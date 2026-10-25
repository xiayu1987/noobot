/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { cp, rename, rm } from "node:fs/promises";
import { text, isFunction } from "@noobot/shared/value";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

export const SESSION_REPAIR_STAGING_MARKER = ".repair-staging-";
export const SESSION_REPAIR_BACKUP_MARKER = ".repair-backup-";

export function isSessionRepairTempDirectoryName(name = "") {
  const value = String(name);
  return (
    value.includes(SESSION_REPAIR_STAGING_MARKER) || value.includes(SESSION_REPAIR_BACKUP_MARKER)
  );
}

function swapFailure(message, details, cause) {
  return Object.assign(new Error(message), {
    code: SESSION_REPAIR_ERROR_CODE.ATOMIC_SWAP_FAILED,
    details,
    cause,
  });
}

const DEFAULT_FS = Object.freeze({ cp, rename, rm });

export async function runAtomicSessionRepair({
  sessionDir = "",
  repair,
  validate,
  fs = DEFAULT_FS,
} = {}) {
  if (!text(sessionDir) || !isFunction(repair) || !isFunction(validate)) {
    throw Object.assign(
      new TypeError("Atomic Session repair requires sessionDir, repair and validate"),
      {
        code: SESSION_REPAIR_ERROR_CODE.REPAIR_ARGUMENT_INVALID,
      },
    );
  }
  const stagingDir = `${sessionDir}${SESSION_REPAIR_STAGING_MARKER}${randomUUID()}`;
  const backupDir = `${sessionDir}${SESSION_REPAIR_BACKUP_MARKER}${randomUUID()}`;
  await fs.cp(sessionDir, stagingDir, { recursive: true, errorOnExist: true });
  let result;
  try {
    result = await repair(stagingDir);
    await validate(stagingDir);
    await fs.rename(sessionDir, backupDir);
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
  try {
    await fs.rename(stagingDir, sessionDir);
  } catch (swapError) {
    try {
      await fs.rename(backupDir, sessionDir);
    } catch (rollbackError) {
      throw swapFailure(
        "Atomic Session repair could not swap or roll back; both copies were preserved",
        { sessionDir, stagingDir, backupDir, rollbackError: rollbackError?.message },
        swapError,
      );
    }
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw swapError;
  }
  await fs.rm(backupDir, { recursive: true, force: true });
  return result;
}
