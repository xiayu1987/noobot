/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "./immutable-object-store.js";

export function immutableOrderKey(ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw immutableStorageError("Invalid immutable session ordinal");
  return String(ordinal).padStart(16, "0");
}
