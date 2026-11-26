/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildSessionDisplayProjectionFromCounts } from "../session-summary-builders/session-display-summary.js";
import { readPartitionSessionSource } from "./partition-session-source.js";
import {
  bindDisplayInterjections,
  projectDisplayThinkingFacets,
} from "./partition-display-thinking.js";

export async function readPartitionDisplayProjection(options) {
  const ordinals = new Map();
  const source = await readPartitionSessionSource({
    ...options,
    readMessagePage: async (page) => {
      const result = await options.ranges.readDisplaySourcePage(options.snapshot, page);
      for (const { message, ordinal } of result.records) ordinals.set(message.messageUid, ordinal);
      return result;
    },
  });
  const counts = await options.messages.readDisplaySourceCounts({ snapshot: options.snapshot });
  const projection = buildSessionDisplayProjectionFromCounts(source, counts, {
    includeThinkingTimeline: options.includeThinkingTimeline,
    selectSourceOrdinal: (message) => ordinals.get(message.messageUid),
  });
  const { journal, scope, snapshot } = options;
  const readInterjection = bindDisplayInterjections(journal, scope, snapshot);
  for (const message of projection.messages) {
    if (message.role !== "assistant") continue;
    const interjection = await readInterjection(message.turnScopeId);
    Object.assign(message, projectDisplayThinkingFacets(message.hasThinkingDetails, interjection));
  }
  return projection;
}
