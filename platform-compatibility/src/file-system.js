/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import { normalizePlatform, PLATFORM } from "./platform.js";

const WINDOWS_TRANSIENT_ATOMIC_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export async function syncDirectory({ directory, open, platform = process.platform }) {
  if (!isFunction(open)) throw new TypeError("directory sync requires an open operation");
  if (normalizePlatform(platform) === PLATFORM.WINDOWS) return false;
  const handle = await open(directory, "r");
  const errors = [];
  try {
    await handle.sync();
  } catch (error) {
    errors.push(error);
  }
  try {
    await handle.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Directory sync and close failed", { cause: errors[0] });
  return true;
}

export function isTransientAtomicRenameError(error, { platform = process.platform } = {}) {
  return (
    normalizePlatform(platform) === PLATFORM.WINDOWS &&
    WINDOWS_TRANSIENT_ATOMIC_RENAME_CODES.has(String(error?.code || ""))
  );
}
