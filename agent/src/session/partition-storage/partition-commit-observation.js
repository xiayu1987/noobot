/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { channel } from "node:diagnostics_channel";
import { performance } from "node:perf_hooks";

export const partitionCommitPhase = channel("noobot.session.partition.commit-phase");
export const partitionEntityPageWrite = channel("noobot.session.partition.entity-page-write");

export function startPartitionCommitPhase() {
  if (!partitionCommitPhase.hasSubscribers) return undefined;
  const token = { startedAt: performance.now() };
  partitionCommitPhase.publish({ event: "start", token });
  return token;
}

export function finishPartitionCommitPhase(phase, token) {
  if (token !== undefined)
    partitionCommitPhase.publish({
      event: "finish",
      phase,
      token,
      elapsedMs: performance.now() - token.startedAt,
    });
}

export function observePartitionCommitPhase(phase, operation) {
  const started = startPartitionCommitPhase();
  if (started === undefined) return operation();
  return (async () => {
    try {
      return await operation();
    } finally {
      finishPartitionCommitPhase(phase, started);
    }
  })();
}
