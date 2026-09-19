/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { cp, rename, rm } from "node:fs/promises";
import { text } from "./repair-primitives.js";

export async function runAtomicSessionRepair({ sessionDir = "", repair, validate } = {}) {
  if (!text(sessionDir) || typeof repair !== "function" || typeof validate !== "function") {
    throw Object.assign(
      new TypeError("Atomic Session repair requires sessionDir, repair and validate"),
      {
        code: "SESSION_REPAIR_ARGUMENT_INVALID",
      },
    );
  }
  const stagingDir = `${sessionDir}.repair-staging-${randomUUID()}`;
  const backupDir = `${sessionDir}.repair-backup-${randomUUID()}`;
  await cp(sessionDir, stagingDir, { recursive: true, errorOnExist: true });
  try {
    const result = await repair(stagingDir);
    await validate(stagingDir);
    await rename(sessionDir, backupDir);
    try {
      await rename(stagingDir, sessionDir);
    } catch (error) {
      await rename(backupDir, sessionDir);
      throw error;
    }
    await rm(backupDir, { recursive: true, force: true });
    return result;
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
