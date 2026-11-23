/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { setTimeout as delay } from "node:timers/promises";

export async function withDescriptorLock(handle, options, operation) {
  let operationError;
  try {
    await acquireDescriptorLock(handle, options);
    return await operation();
  } catch (error) {
    operationError = [error];
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (operationError) {
        throw new AggregateError(
          [...operationError, error],
          "Descriptor operation and close failed",
        );
      }
      throw error;
    }
  }
}

export async function tryAcquireDescriptorLock(handle, { shared = false } = {}) {
  const { tryLock } = (await import("fs-native-extensions")).default;
  return tryLock(handle.fd, { shared });
}

export async function acquireDescriptorLock(
  handle,
  { deadline, pollMs, timeoutError, shared = false, signal },
) {
  for (;;) {
    signal?.throwIfAborted();
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw timeoutError();
    if (await tryAcquireDescriptorLock(handle, { shared })) return;
    try {
      await delay(Math.min(remaining, pollMs), undefined, { signal });
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    }
  }
}
