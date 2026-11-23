/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isContextSourceMessageCandidate } from "@noobot/context-protocol/assembly/source";
import { updatePartitionContextMembership } from "@noobot/session-protocol/partition-context-index";
import { createPartitionIndexMutations } from "./partition-index-mutations.js";

export async function preparePartitionContextIndex(view, mutations, messageTransitions) {
  const plan = createPartitionIndexMutations(view, mutations);
  const transitions = [];
  for (const { before: previous, after: next } of messageTransitions) {
    const candidate = next !== null && isContextSourceMessageCandidate(next.message);
    const wasCandidate = previous !== null && isContextSourceMessageCandidate(previous.message);
    if (candidate === wasCandidate) continue;
    const record = next ?? previous;
    const { dialogProcessId } = record.message;
    transitions.push({
      dialogProcessId,
      ordinal: record.sessionOrdinal,
      present: candidate,
    });
  }
  await updatePartitionContextMembership({ ...plan, getOriginal: plan.read }, transitions);
  await plan.apply();
}
