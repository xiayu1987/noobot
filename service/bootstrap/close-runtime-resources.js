/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function closeRuntimeResources({
  stopManagedInstances,
  closeHttp,
  closeBot,
  releaseConnectors,
  flushEvents,
}) {
  const failures = [];
  for (const close of [stopManagedInstances, closeHttp, closeBot, releaseConnectors, flushEvents]) {
    try {
      await close();
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Runtime resource cleanup failed");
}
