/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function groupPartitionWrites(writes) {
  const groups = new Map();
  for (const write of writes) {
    const partition = write.receipt.cursor.partition;
    if (!groups.has(partition)) groups.set(partition, []);
    groups.get(partition).push(write);
  }
  return groups;
}
