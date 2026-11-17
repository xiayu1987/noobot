/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import {
  readIndexedTurnLifecycle,
  projectIndexedLifecycleResult,
} from "../domain/indexed-turn-lifecycle.js";
import { transitionPreparedTurnLifecycle } from "../domain/turn-lifecycle-entity.js";
import { prepareTurnLifecycleCommit } from "./commit-turn-lifecycle.js";

export async function commitIndexedTurnLifecycle(options) {
  if (!isFunction(options.now))
    throw new TypeError("commitTurnLifecycle requires an Authority clock");
  const { lifecycle, reason } = await readIndexedTurnLifecycle({
    ...options,
    input: options.event,
  });
  if (reason) return { applied: false, reason, changedTurns: [] };
  const flow = prepareTurnLifecycleCommit({ ...options, lifecycle }, (source, input, now) =>
    transitionPreparedTurnLifecycle(structuredClone(source), input, now),
  );
  let step = flow.next();
  while (!step.done) step = flow.next(await step.value());
  const result = projectIndexedLifecycleResult(lifecycle, step.value);
  if (result.applied) {
    result.commandReceipt = step.value.lifecycle.commandReceipts.find(
      (receipt) => receipt.commandId === options.event.commandId,
    );
  }
  return result;
}
