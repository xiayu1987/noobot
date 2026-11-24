/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { isFunction } from "@noobot/shared/value";
import { normalizePlatform, PLATFORM } from "./platform.js";

const WINDOWS_TRANSIENT_ATOMIC_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export function fileSyncOpenFlags(platform = process.platform) {
  return normalizePlatform(platform) === PLATFORM.WINDOWS ? "r+" : "r";
}

export function createdDirectoryDepth(directory, firstCreated) {
  const target = path.toNamespacedPath(path.resolve(directory));
  const ancestor = path.dirname(path.toNamespacedPath(path.resolve(firstCreated)));
  const relative = path.relative(ancestor, target);
  const segments = relative.split(path.sep);
  if (!relative || segments[0] === ".." || path.isAbsolute(relative))
    throw new TypeError("Created directory must be inside its existing ancestor");
  return segments.length;
}

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
