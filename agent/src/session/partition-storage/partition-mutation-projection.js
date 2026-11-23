/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText } from "@noobot/shared/value";
import { projectPartitionMutation } from "@noobot/session-protocol/partition-mutation-projection";
import { createMessageReadBudget } from "@noobot/session-protocol/message-read-budget";
import { checkPartitionMessageStorage } from "./partition-message-record.js";
import { materializeMessage } from "./partition-message-reader.js";

export async function readPartitionMutationProjection(transactions, snapshot, scope, commandId) {
  if (!isCanonicalText(commandId))
    throw new TypeError("Mutation projection requires a canonical command ID");
  const source = await transactions.readEntityTransaction({
    snapshot,
    collection: "commands",
    key: commandId,
  });
  if (source === null) return null;
  const budget = createMessageReadBudget();
  return projectPartitionMutation({
    ...source,
    commandId,
    sessionId: scope.sessionId,
    async materialize(record, read, lifecycle) {
      checkPartitionMessageStorage(record, {
        snapshot,
        scope,
        messageUid: record.message.messageUid,
        generation: source.generation,
      });
      return materializeMessage(
        async ({ collection, keys }) =>
          new Map(
            keys.map((key) => {
              const value = read(collection, key);
              return [key, value === null ? null : { value }];
            }),
          ),
        { snapshot, record, lifecycle, budget },
      );
    },
  });
}
