/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readPartitionStorageRoot } from "../session-storage-authority.js";

export async function readPartitionSessionAuthority(sessionDir) {
  return (await readPartitionStorageRoot(sessionDir)) !== null;
}
