/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";

export function emptyPartitionSession({ sessionId, parentSessionId, committedAt }) {
  return {
    sessionId,
    parentSessionId,
    caller: "user",
    aggregateVersion: 0,
    modelAlias: "",
    shortMemoryCheckpoint: 0,
    selectedConnectorIds: [],
    messages: [],
    dialogOrder: [],
    turnTimings: [],
    sessionArtifactEvents: [],
    turnLifecycle: createEmptyTurnLifecycle(),
    createdAt: committedAt,
    updatedAt: committedAt,
  };
}

export async function initializePartitionSession(journal, scope, committedAt) {
  const transactions = new PartitionSessionTransactions(journal, scope);
  const request = await journal.usingSnapshot((snapshot) =>
    transactions.prepareInitialization(snapshot, {
      operationId: "bootstrap",
      scopedMetadata: null,
      session: emptyPartitionSession({ ...scope, committedAt }),
    }),
  );
  return transactions.initialize(request);
}
