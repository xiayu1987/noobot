/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { commitIndexedTurnReplacement } from "@noobot/authoritative-state/application";
import {
  createTurnReplaceFingerprint,
  createTurnReplacementCommit,
  parseTurnReplacementChange,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import { PartitionAdmissionRejection } from "@noobot/session-protocol/partition-journal";
import { PARTITION_MESSAGE_COLLECTIONS as collections } from "@noobot/session-protocol/partition-session-messages";
import {
  createPartitionReplacementReference,
  readPartitionReplacement,
} from "@noobot/session-protocol/partition-turn-visibility";
import { createTurnReplacementMessage } from "../entities/turn-replacement-message.js";
import { preparePartitionSuffixCommand } from "./partition-message-deletion.js";

export function preparePartitionTurnReplacement({ request, appendReplacement, ...options }) {
  const { command, identity } = parseTurnReplacementChange(request);
  const requestHash = createTurnReplaceFingerprint(command);
  return preparePartitionSuffixCommand({
    ...options,
    command,
    type: SESSION_COMMAND.TURN_REPLACE,
    requestHash,
    resultField: "turnReplacement",
    async prepareLifecycle({ suffix, lookup, aggregateVersion, header, turnScopeIds, readTurn }) {
      const { messageUid, dialogProcessId } = identity;
      const { turnScopeId, commandId } = command;
      const addresses = [
        [collections.messages, messageUid],
        ["dialogs", dialogProcessId],
        [collections.turns, turnScopeId],
        ["lifecycle", turnScopeId],
        ["replacements", turnScopeId],
      ];
      for (const [collection, key] of addresses)
        if ((await lookup({ collection, key })) !== null)
          throw new PartitionAdmissionRejection(
            "SESSION_ENTITY_EXISTS",
            "Turn replacement requires fresh identities",
          );
      const replacement = createTurnReplacementCommit({
        commandId,
        sessionId: options.scope.sessionId,
        committedAggregateVersion: aggregateVersion,
        replacedTurnScopeIds: turnScopeIds,
        replacementDialogProcessId: dialogProcessId,
        replacementTurnScopeId: turnScopeId,
        replacementUserMessageUid: messageUid,
        requestHash,
        committedAt: options.committedAt,
      });
      const read = async (collection, key) => {
        const entry = await lookup({ collection, key });
        return entry === null || entry.mutation.remove ? null : entry.mutation.value;
      };
      const lifecycle = await commitIndexedTurnReplacement({
        header,
        replacement,
        readTurn,
        readReplacement: (key) =>
          readPartitionReplacement(read, {
            sessionId: options.scope.sessionId,
            turnScopeId: key,
            lifecycleSequence: header.sequence,
          }),
        async readCommandReplacement(key) {
          const receipt = await read("commands", key);
          return receipt === null ? null : receipt.result.turnReplacement;
        },
      });
      if (!lifecycle.applied)
        throw new PartitionAdmissionRejection("SESSION_TURN_IDENTITY_CONFLICT", lifecycle.reason);
      const message = createTurnReplacementMessage(
        suffix.anchorMessage,
        command,
        identity,
        options.committedAt,
      );
      const { mutations, messageCount } = await appendReplacement(
        message,
        suffix.retainedMessageCount,
      );
      for (const tombstone of lifecycle.changedReplacements) {
        mutations.push({
          collection: "replacements",
          key: tombstone.turnScopeId,
          value: createPartitionReplacementReference(tombstone),
          owner: null,
        });
      }
      return {
        lifecycle,
        result: { turnReplacement: replacement },
        appendedMutations: mutations,
        messageCount,
      };
    },
  });
}
