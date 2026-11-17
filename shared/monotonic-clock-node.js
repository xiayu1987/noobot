/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

export const MONOTONIC_CLOCK_ID = randomUUID();

export function monotonicTiming() {
  return { clockId: MONOTONIC_CLOCK_ID, atMs: performance.now() };
}
