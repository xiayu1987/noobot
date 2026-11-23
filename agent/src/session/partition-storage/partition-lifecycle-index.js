/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LifecycleTerminalIndex } from "@noobot/session-protocol/lifecycle-terminal-index";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { createPartitionIndexMutations } from "./partition-index-mutations.js";

export const partitionLifecycleIndex = new LifecycleTerminalIndex((message) =>
  partitionJournalError("SESSION_STORAGE_CORRUPT", message),
);

export async function preparePartitionLifecycleIndex(view, mutations) {
  if (!mutations.some(({ collection }) => collection === "lifecycle" || collection === "turns"))
    return;
  const plan = createPartitionIndexMutations(view, mutations);
  await partitionLifecycleIndex.prepare(plan);
  await plan.apply();
}
