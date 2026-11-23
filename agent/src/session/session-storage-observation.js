/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { SESSION_CHECKPOINT_FORBIDDEN_WORK } from "@noobot/session-protocol/session-storage-work";

const observations = new AsyncLocalStorage();

export function recordStorageWork(name, amount = 1) {
  const work = observations.getStore();
  if (work) work[name] = (work[name] ?? 0) + amount;
}

export async function observeSessionStorageWork(operation) {
  const work = Object.fromEntries(SESSION_CHECKPOINT_FORBIDDEN_WORK.map((name) => [name, 0]));
  const result = await observations.run(work, operation);
  return { result, work };
}

export function capturePartitionJournalWork() {
  const work = observations.getStore();
  if (!work) return undefined;
  return (batchWork) => {
    const journal = (work.partitionJournal ??= {});
    for (const [name, amount] of Object.entries(batchWork))
      journal[name] = (journal[name] ?? 0) + amount;
  };
}
