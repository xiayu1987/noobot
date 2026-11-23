/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const partitionEpochOctets = 16;
export const partitionEpochHexLength = partitionEpochOctets * 2;

export function isPartitionEpoch(value) {
  return (
    typeof value === "string" &&
    value.length === partitionEpochHexLength &&
    !/[^a-f0-9]/.test(value)
  );
}
