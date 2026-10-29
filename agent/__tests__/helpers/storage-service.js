/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StorageService } from "../../src/session/storage-service.js";
import { ATOMIC_RENAME_RETRY_DELAYS_MS } from "../../src/shared/storage/atomic-file-write.js";

export const TEST_STORAGE_SERVICE = new StorageService({
  atomicRenameRetryDelaysMs: ATOMIC_RENAME_RETRY_DELAYS_MS,
  platform: process.platform,
});
