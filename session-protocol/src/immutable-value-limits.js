/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export const IMMUTABLE_VALUE_BLOCK_BYTES = LENGTH_THRESHOLDS.immutableStorage.blockBytes;

export const IMMUTABLE_VALUE_MAX_DEPTH = Math.ceil(
  Math.log2(Number.MAX_SAFE_INTEGER / IMMUTABLE_VALUE_BLOCK_BYTES),
);
