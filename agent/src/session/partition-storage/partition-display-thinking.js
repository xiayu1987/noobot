/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readPartitionLatestUserInterjection } from "./partition-outbox.js";
import { PartitionTransactions } from "./partition-transactions.js";

export function bindDisplayInterjections(journal, scope, snapshot) {
  const turns = new Map();
  const transactions = new PartitionTransactions(journal);
  const readPage = (operation) => transactions.withCollectionReader(snapshot, operation);
  return (turnScopeId) => {
    if (!turns.has(turnScopeId)) {
      turns.set(
        turnScopeId,
        readPartitionLatestUserInterjection(readPage, scope, snapshot, turnScopeId),
      );
    }
    return turns.get(turnScopeId);
  };
}

export function projectDisplayThinkingFacets(hasTimeline, interjection) {
  return {
    ...(hasTimeline || interjection !== null ? { hasThinkingDetails: true } : {}),
    ...(interjection === null ? {} : { thinkingContentTimeline: [interjection] }),
  };
}
