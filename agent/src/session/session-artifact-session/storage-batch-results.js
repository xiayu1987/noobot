/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export async function runStorageBatch(nodes, operation) {
  let cursor = 0;
  let failed = false;
  const workers = Array.from(
    { length: Math.min(nodes.length, QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency) },
    async () => {
      while (!failed && cursor < nodes.length) {
        const node = nodes[cursor++];
        try {
          await operation(node);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    },
  );
  assertStorageBatchSucceeded(await Promise.allSettled(workers));
}

export function assertStorageBatchSucceeded(results) {
  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Session storage batch failed", { cause: errors[0] });
}
