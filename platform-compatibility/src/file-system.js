/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizePlatform, PLATFORM } from "./platform.js";

const WINDOWS_TRANSIENT_ATOMIC_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export function isTransientAtomicRenameError(error, { platform = process.platform } = {}) {
  return (
    normalizePlatform(platform) === PLATFORM.WINDOWS &&
    WINDOWS_TRANSIENT_ATOMIC_RENAME_CODES.has(String(error?.code || ""))
  );
}
