/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StorageService } from "noobot-agent/session";
import { ATOMIC_RENAME_RETRY_DELAYS_MS } from "@noobot/platform-compatibility/atomic-file-write";

export const TEST_STORAGE_SERVICE = new StorageService({
  atomicRenameRetryDelaysMs: ATOMIC_RENAME_RETRY_DELAYS_MS,
  platform: process.platform,
});
