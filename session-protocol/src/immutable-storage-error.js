/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function immutableStorageError(message, cause) {
  return Object.assign(new Error(message, { cause }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
}
