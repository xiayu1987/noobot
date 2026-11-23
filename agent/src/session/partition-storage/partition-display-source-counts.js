/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applySessionDisplaySourceDelta,
  emptySessionDisplaySourceCounts,
  requireSessionDisplaySourceCounts,
  sessionDisplayMessageContribution,
} from "@noobot/session-protocol/session-reader";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { readPartitionSessionMessageCount } from "@noobot/session-protocol/partition-session-messages";

function requireStoredCounts(value, count) {
  try {
    return requireSessionDisplaySourceCounts(value, count);
  } catch (cause) {
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
}

export function partitionDisplaySourceCounts(statistics) {
  const { messageCount, injectedMessageCount, toolLogCount } = statistics;
  return {
    messageCount,
    ...requireStoredCounts({ injectedMessageCount, toolLogCount }, messageCount),
  };
}

function subtractCounts({ injectedMessageCount, toolLogCount }) {
  return { injectedMessageCount: -injectedMessageCount, toolLogCount: -toolLogCount };
}

function planDelta(transitions) {
  let delta = emptySessionDisplaySourceCounts();
  for (const { before, after } of transitions) {
    if (before !== null) {
      delta = applySessionDisplaySourceDelta(
        delta,
        subtractCounts(sessionDisplayMessageContribution(before.message)),
      );
    }
    if (after !== null)
      delta = applySessionDisplaySourceDelta(
        delta,
        sessionDisplayMessageContribution(after.message),
      );
  }
  return delta;
}

export async function calculatePartitionDisplaySourceCounts(read, statistics, transitions) {
  const delta = planDelta(transitions);
  const { injectedMessageCount, toolLogCount } = statistics;
  const count = await readPartitionSessionMessageCount(read);
  const next = applySessionDisplaySourceDelta({ injectedMessageCount, toolLogCount }, delta);
  return { messageCount: count, ...requireStoredCounts(next, count) };
}
