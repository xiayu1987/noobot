/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createPartitionMutationReader } from "@noobot/session-protocol/partition-transaction";
import {
  PARTITION_MESSAGE_COLLECTIONS as collections,
  partitionMessageContentVersion,
  requirePartitionMessageTurnOwnership,
} from "@noobot/session-protocol/partition-session-messages";
import { decideTurnAcceptanceVersionAdvance } from "@noobot/session-protocol";
import { preparePartitionScopedMetadata } from "@noobot/session-protocol/partition-session-state";
import {
  prepareUserMetaResult,
  preparePartitionAttachmentBinding,
  preparePartitionSessionMetadata,
} from "./partition-message-commands.js";
import { normalizePartitionMessageChanges } from "./partition-message-input.js";
import {
  preparePartitionCheckpointRequests,
  preparePartitionSummaryCheckpoints,
} from "./partition-summary-checkpoints.js";
import { preparePartitionTurnTransition } from "./partition-turn-lifecycle.js";
import { preparePartitionTimings } from "./partition-turn-timings.js";
import { preparePartitionToolPairCreations } from "./partition-tool-pairs.js";
import { preparePartitionOutbox } from "./partition-outbox.js";
import { preparePartitionMessageDeletion } from "./partition-message-deletion.js";
import { preparePartitionTurnReplacement } from "./partition-turn-replacement.js";
import {
  prepareMessageCreations,
  prepareReplacementMessage,
} from "./partition-message-creations.js";
import { preparePartitionMessageDiagnostics } from "./partition-message-diagnostics.js";
import { prepareMessageUpdates } from "./partition-message-updates.js";
import {
  checkMessage,
  readSessionOrderRecord,
  readVisibleMessagePosition,
  readPartitionSuffixAnchor,
} from "./partition-message-reader.js";
import { preparePartitionLifecycleIndex } from "./partition-lifecycle-index.js";
import { preparePartitionContextIndex } from "./partition-context-index.js";
import { readPartitionMessageTransitions } from "./partition-message-transitions.js";
import { preparePartitionDisplayTransaction } from "./partition-display-transaction.js";
import { observePartitionCommitPhase } from "./partition-commit-observation.js";
import { preparePartitionSessionTitle } from "./partition-session-title.js";

function set(collection, key, value, owner = null) {
  return { collection, key, value, owner };
}

async function* readSuffixPages(identity, view, suffix) {
  let end = suffix.deletedCount;
  while (end > 0) {
    const page = await view.readWindow(
      Math.min(end, view.pageRecords),
      async (getLatestMany, index) => {
        return readSessionOrderRecord(
          { ...identity, read: createPartitionMutationReader(getLatestMany) },
          suffix.messageSuffix.firstOrdinal + end - index - 1,
        );
      },
    );
    end -= page.length;
    yield page.reverse();
  }
}

async function prepareSuffixChange({
  snapshot,
  view,
  read,
  scope,
  messageDeletion,
  turnReplacement,
  committedAt,
}) {
  const identity = { read, scope, snapshot, generation: view.generation };
  const prepare = turnReplacement
    ? preparePartitionTurnReplacement
    : preparePartitionMessageDeletion;
  return prepare({
    ...identity,
    view,
    request: turnReplacement ?? messageDeletion,
    committedAt,
    findSuffix: (turnScopeId) =>
      readPartitionSuffixAnchor({ ...identity, turnScopeId }, Boolean(turnReplacement)),
    appendReplacement: (message, retainedCount) =>
      prepareReplacementMessage({
        view,
        scope,
        snapshot,
        message,
        retainedCount,
        generation: view.generation + 1,
      }),
    readSuffixPages: (suffix) => readSuffixPages(identity, view, suffix),
  });
}

function requirePreviousMessageReader(read, { scope, snapshot, generation }) {
  return async (record, identity) => {
    const visible = await readVisibleMessagePosition(
      read,
      scope.sessionId,
      checkMessage(record, { ...identity, snapshot, scope, generation }),
    );
    return visible === null ? null : visible.record;
  };
}

function duplicateCheckpointResult(checkpoints) {
  return {
    action: "abort",
    result: {
      messageReceipts: [],
      summaryCheckpoints: checkpoints.map(({ duplicate, turnScopeId }) => ({
        ...duplicate,
        turnScopeId,
      })),
    },
  };
}

async function prepareMessages({ snapshot, view, input, scope, sourceDialog }) {
  const request = normalizePartitionMessageChanges(input);
  const { attachmentBinding, userMetaParsedResult, messageDeletion, turnReplacement } =
    request.changes;
  const { committedAt } = request;
  const read = createPartitionMutationReader(view.getLatestMany);
  if (messageDeletion || turnReplacement)
    return prepareSuffixChange({
      snapshot,
      view,
      read,
      scope,
      messageDeletion,
      turnReplacement,
      committedAt,
    });
  if (attachmentBinding || userMetaParsedResult) {
    const requirePreviousMessage = requirePreviousMessageReader(read, {
      scope,
      snapshot,
      generation: view.generation,
    });
    if (attachmentBinding)
      return preparePartitionAttachmentBinding({
        view,
        scope,
        requirePreviousMessage,
        request: attachmentBinding,
        committedAt,
      });
    return prepareUserMetaResult(view, requirePreviousMessage, userMetaParsedResult, committedAt);
  }
  return prepareMessageBatch({ snapshot, view, read, scope, request, sourceDialog });
}

function shouldTouchSession({
  messages,
  entities,
  turnTransition,
  timings,
  artifactEvents,
  checkpoints,
}) {
  return (
    messages.length > 0 ||
    entities.length > 0 ||
    Boolean(turnTransition) ||
    timings.length > 0 ||
    artifactEvents.length > 0 ||
    checkpoints.some(({ duplicate }) => !duplicate)
  );
}

async function prepareMessageBatch({ snapshot, view, read, scope, request, sourceDialog }) {
  const generation = view.generation + 1;
  const {
    changes: {
      messages: requestedMessages,
      messageDiagnostics,
      messageContentAppends,
      messageContentReplacements,
      messageMetadataUpdates,
      sessionMetadata,
      scopedMetadata,
      turnTransition,
      summaryCheckpoints,
      timings,
      deliveries,
      outboxCursors,
      outboxMaintenance,
      artifactEvents,
    },
    committedAt,
    entities: requestedEntities,
  } = request;
  const { entries, replayedMessageUids } = await preparePartitionCheckpointRequests({
    snapshot,
    view,
    scope,
    inputs: summaryCheckpoints,
    committedAt,
  });
  const messages = requestedMessages.filter(
    ({ messageUid }) => !replayedMessageUids.has(messageUid),
  );
  const { turns: turnRecords } = await requirePartitionMessageTurnOwnership(
    read,
    messages,
    turnTransition,
  );
  const entities = requestedEntities.filter(({ key }) => !replayedMessageUids.has(key));
  const appends = new Map(messageContentAppends.map((append) => [append.messageUid, append]));
  const replacements = new Map(
    messageContentReplacements.map((write) => [write.messageUid, write]),
  );
  const updates = new Map(messageMetadataUpdates.map((update) => [update.messageUid, update]));
  const turns = new Map();
  const mutations = [];
  const state = { snapshot, scope, generation, turns, mutations };
  const contentVersion = () =>
    partitionMessageContentVersion(snapshot.epoch, generation, mutations.length);
  await prepareMessageCreations(view, read, state, {
    messages,
    contentVersion,
    records: turnRecords,
    sourceDialog,
  });
  await prepareMessageUpdates(view, read, state, { entities, appends, replacements, updates });
  for (const [key, { owner, ...value }] of turns)
    mutations.push(set(collections.turns, key, value, owner));
  mutations.push(...(await preparePartitionToolPairCreations({ view, messages, snapshot, scope })));
  await preparePartitionMessageDiagnostics(
    view,
    mutations,
    messageDiagnostics.filter(({ messageUid }) => !replayedMessageUids.has(messageUid)),
  );
  let result = null;
  if (turnTransition) {
    const lifecycle = await preparePartitionTurnTransition({
      view,
      scope,
      event: turnTransition,
      committedAt,
      snapshot,
    });
    if (!lifecycle.result.applied)
      return { action: "abort", result: { turnTransition: lifecycle.result, messageReceipts: [] } };
    result = { terminalMaterialized: lifecycle.result.terminalMaterialization !== null };
    mutations.push(...lifecycle.mutations);
  }
  await preparePartitionTimings({ view, mutations, timings, snapshot, scope });
  const advanceVersion =
    turnTransition && decideTurnAcceptanceVersionAdvance(turnTransition, messages);
  const checkpoints = await preparePartitionSummaryCheckpoints({
    snapshot,
    view,
    mutations,
    scope,
    entries,
    committedAt,
  });
  if (scopedMetadata) await preparePartitionScopedMetadata(view, mutations, scopedMetadata);
  if (
    checkpoints.length &&
    !mutations.length &&
    !sessionMetadata &&
    !artifactEvents.length &&
    !deliveries?.length &&
    !outboxCursors?.length &&
    !outboxMaintenance
  )
    return duplicateCheckpointResult(checkpoints);
  if (checkpoints.length) result = { ...result, summaryCheckpoints: checkpoints };
  await preparePartitionSessionMetadata(view, mutations, {
    sessionMetadata,
    advanceVersion,
    touch: shouldTouchSession({
      messages,
      entities,
      turnTransition,
      timings,
      artifactEvents,
      checkpoints,
    }),
    committedAt,
  });
  const outbox = await preparePartitionOutbox({
    view,
    mutations,
    changes: { deliveries, outboxCursors, outboxMaintenance, artifactEvents },
    scope,
    snapshot,
  });
  if (outbox) result = { ...result, ...outbox };
  return { action: "commit", mutations, result };
}

export async function prepareIndexedMessages(plan) {
  const { snapshot, view, scope } = plan;
  const { retiredMessages = [], ...prepared } = await prepareMessages(plan);
  if (prepared.action !== "commit") return prepared;
  const transitions = await readPartitionMessageTransitions(view, prepared.mutations);
  for (const before of retiredMessages) transitions.push({ before, after: null });
  await preparePartitionSessionTitle({ view, mutations: prepared.mutations, transitions });
  await observePartitionCommitPhase("prepareLifecycleIndex", () =>
    preparePartitionLifecycleIndex(view, prepared.mutations),
  );
  await observePartitionCommitPhase("prepareContextIndex", () =>
    preparePartitionContextIndex(view, prepared.mutations, transitions),
  );
  await observePartitionCommitPhase("prepareDisplayProjection", () =>
    preparePartitionDisplayTransaction({
      snapshot,
      view,
      mutations: prepared.mutations,
      scope,
      transitions,
    }),
  );
  return prepared;
}

export function prepareLiveMessages(snapshot, view, input, scope) {
  return prepareIndexedMessages({ snapshot, view, input, scope });
}
