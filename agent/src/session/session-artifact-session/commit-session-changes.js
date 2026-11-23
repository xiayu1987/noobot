/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  applySessionSettings,
  decideAggregateConcurrency,
  createScopedSessionMetadataRecord,
  mergeTurnTimingRecord,
  normalizeTurnTimingRecord,
  requireTurnTimingOwnership,
} from "@noobot/session-protocol";
import {
  mergeUserMetaParsedResults,
  requireImmutableSessionChanges,
  requirePreparedSessionCommitRequest,
} from "@noobot/session-protocol/session-changes";
import {
  immutableCheckpointMessageResult,
  requireImmutableCommitOrigin,
} from "@noobot/session-protocol/immutable-storage-graph";
import {
  ImmutableSessionChanges,
  prepareImmutableMessages,
  publishMessageIndexes,
} from "./immutable-message-changes.js";
import { prepareImmutableTurnCommit } from "./immutable-lifecycle-changes.js";
import { appendImmutableEvent } from "./immutable-event-changes.js";
import {
  prepareImmutableDeliveries,
  prepareImmutableOutboxCursors,
  prepareImmutableOutboxMaintenance,
} from "./immutable-outbox.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { prepareImmutableSummaryCheckpoint } from "./immutable-summary-changes.js";
import { immutableCheckpointKey } from "./immutable-checkpoint-index.js";
import { prepareImmutableAttachmentBinding } from "./immutable-attachment-binding.js";
import { prepareImmutableMessageDeletion } from "./immutable-message-deletion.js";
import { prepareImmutableTurnReplacement } from "./immutable-turn-replacement.js";
import { prepareImmutableLifecycleIndex } from "./immutable-lifecycle-index.js";
import { prepareImmutableMessageUpdates } from "./immutable-message-content-appends.js";
import { prepareImmutableMessageDiagnostics } from "./immutable-message-diagnostics.js";
import { projectImmutableSessionCommitResult } from "./immutable-message-receipts.js";

async function prepareTimings(plan, timings) {
  for (const source of timings) {
    const incoming = normalizeTurnTimingRecord(source);
    const owner =
      (await plan.get("turns", incoming.turnScopeId)) ??
      (await plan.get("lifecycle", incoming.turnScopeId));
    requireTurnTimingOwnership(incoming, owner?.dialogProcessId);
    const previous = await plan.get("timings", incoming.turnScopeId);
    plan.set(
      "timings",
      incoming.turnScopeId,
      previous ? mergeTurnTimingRecord(previous, incoming) : incoming,
    );
  }
}

async function prepareArtifactEvent(store, plan, event) {
  const record = await appendImmutableEvent(store, plan, event);
  if (!record.artifact) return record.envelope;
  const metadata = await plan.get("metadata", "session");
  const concurrency = decideAggregateConcurrency({
    expectedAggregateVersion: null,
    aggregateVersion: metadata.aggregateVersion,
  });
  if (!concurrency.allowed) throw new TypeError(`Authority event rejected: ${concurrency.reason}`);
  if (record.envelope.ordering.aggregateVersion !== concurrency.nextAggregateVersion)
    throw new TypeError("Authority event aggregate version mismatch");
  plan.set("metadata", "session", {
    ...metadata,
    aggregateVersion: concurrency.nextAggregateVersion,
  });
  return record.envelope;
}

async function prepareCheckpointReplays({ store, plan, checkpoints, committedAt, generation }) {
  const duplicateCheckpoints = new Map();
  const replayedMessageUids = new Set();
  for (const checkpoint of checkpoints) {
    const key = immutableCheckpointKey(checkpoint.turnScopeId, checkpoint.checkpointId);
    if (!(await plan.get("checkpoints", key))) continue;
    const prepared = await prepareImmutableSummaryCheckpoint({
      store,
      plan,
      checkpoint,
      committedAt,
    });
    const origin = requireImmutableCommitOrigin(
      await plan.get("checkpointCommits", key),
      generation,
    );
    duplicateCheckpoints.set(checkpoint, { ...prepared, originGeneration: origin.generation });
    for (const message of [
      ...checkpoint.messages,
      ...(checkpoint.messageContentAppends ?? []),
      ...(checkpoint.messageMetadataUpdates ?? []),
    ])
      replayedMessageUids.add(message.messageUid);
  }
  return { duplicateCheckpoints, replayedMessageUids };
}

export async function commitScopedImmutableSessionChanges(store, request, validateSnapshot) {
  const prepared = requirePreparedSessionCommitRequest(request);
  if (prepared.epoch !== null)
    throw new TypeError("Immutable storage cannot commit a partition request");
  return transactSessionChanges(store, prepared, validateSnapshot);
}

function transactSessionChanges(
  store,
  { expectedGeneration, operationId, input },
  validateSnapshot,
) {
  return store.transact({
    expectedGeneration,
    operationId,
    input,
    validateSnapshot,
    validateInput: ({ changes }) => requireImmutableSessionChanges(changes),
    projectResult: async (outcome, snapshot, record) => ({
      ...outcome,
      result: await projectImmutableSessionCommitResult(store, snapshot, record, outcome.result),
    }),
    prepare: (context) => prepareSessionChanges(store, context),
  });
}

async function prepareSessionChanges(
  store,
  { get, getMany, getManyMetadata, getMetadata, input, snapshot },
) {
  const delta = input.changes;
  const plan = new ImmutableSessionChanges(get, {
    getMany,
    getManyMetadata,
    getMetadata,
    readContent: (reference) => store.objects.readValue(reference),
  });
  const read = (collection, key) => plan.get(collection, key);
  const original = await read("metadata", "session");
  if (!original) throw immutableStorageError("Immutable session is not initialized");
  if (delta.userMetaParsedResult) {
    return prepareUserMetaResult({ store, plan, original, input });
  }
  return prepareSessionMutation({ store, plan, read, input, generation: snapshot.generation });
}

async function prepareUserMetaResult({ store, plan, original, input }) {
  const { sessionId } = store;
  const { messageUid, result } = input.changes.userMetaParsedResult;
  const stored = await plan.getMetadata("messages", messageUid);
  if (!stored)
    throw Object.assign(new Error(`user_meta source message not found: ${messageUid}`), {
      code: "USER_META_SOURCE_NOT_FOUND",
      statusCode: 409,
    });
  const { value, parts } = stored;
  if (value.message.messageUid !== messageUid || value.message.sessionId !== sessionId)
    throw immutableStorageError("User meta source index ownership mismatch");
  if (value.message.role !== "user")
    throw Object.assign(new Error(`user_meta source must be a user message: ${messageUid}`), {
      code: "USER_META_SOURCE_ROLE_CONFLICT",
      statusCode: 409,
    });
  const userMetaParsedResults = mergeUserMetaParsedResults(
    value.message.userMetaParsedResults,
    result,
  );
  plan.set(
    "messages",
    messageUid,
    {
      ...value,
      message: { ...value.message, userMetaParsedResults },
    },
    parts,
  );
  await publishMessageIndexes(store, plan);
  plan.set("metadata", "session", { ...original, updatedAt: input.committedAt });
  return {
    changes: plan.changes(),
    result: { userMetaParsedResult: { userMetaParsedResults } },
  };
}

async function prepareSessionMutation({ store, plan, read, input, generation }) {
  const delta = input.changes;
  if (delta.turnReplacement) {
    const result = await prepareImmutableTurnReplacement({
      store,
      plan,
      request: delta.turnReplacement,
      committedAt: input.committedAt,
    });
    if (!result.deduplicated) {
      await prepareImmutableLifecycleIndex(plan);
    }
    return {
      abort: result.deduplicated,
      changes: plan.changes(),
      result: { turnReplacement: result },
    };
  }
  if (delta.messageDeletion) {
    const result = await prepareImmutableMessageDeletion({
      store,
      plan,
      request: delta.messageDeletion,
      committedAt: input.committedAt,
    });
    if (!result.deduplicated) {
      await prepareImmutableLifecycleIndex(plan);
    }
    return {
      abort: result.deduplicated,
      changes: plan.changes(),
      result: { messageDeletion: result },
    };
  }
  if (delta.attachmentBinding) {
    const result = await prepareImmutableAttachmentBinding({
      store,
      plan,
      request: delta.attachmentBinding,
      committedAt: input.committedAt,
    });
    return {
      abort: result.deduplicated,
      changes: plan.changes(),
      result: { attachmentBinding: result },
    };
  }
  return prepareAggregateChanges({ store, plan, read, input, generation });
}

async function prepareAggregateChanges({ store, plan, read, input, generation }) {
  const delta = input.changes;
  const result = {};
  const { duplicateCheckpoints, replayedMessageUids } = await prepareCheckpointReplays({
    store,
    plan,
    checkpoints: delta.summaryCheckpoints ?? [],
    committedAt: input.committedAt,
    generation,
  });
  const messages = (delta.messages ?? []).filter(
    (message) => !replayedMessageUids.has(message.messageUid),
  );
  const preparedMessages = await prepareMessageChanges({
    store,
    plan,
    input,
    messages,
    result,
  });
  if (preparedMessages?.abort) return preparedMessages;
  await prepareMessageUpdates({ store, plan, input, replayedMessageUids, result });
  await prepareImmutableMessageDiagnostics(
    plan,
    (delta.messageDiagnostics ?? []).filter(
      ({ messageUid }) => !replayedMessageUids.has(messageUid),
    ),
  );
  await prepareCheckpoints({ store, plan, input, duplicateCheckpoints, result, generation });
  await prepareDeliveryChanges({ store, plan, input, result });
  await prepareSessionMetadata({ plan, read, input, messages });
  await prepareImmutableLifecycleIndex(plan);
  const changes = plan.changes();
  const abort =
    changes.length === 0 &&
    result.summaryCheckpoints.length > 0 &&
    result.summaryCheckpoints.every((checkpoint) => checkpoint.deduplicated === true);
  return { abort, changes, result };
}

async function prepareMessageChanges({ store, plan, input, messages, result }) {
  const delta = input.changes;
  if (delta.turnTransition) {
    const prepared = await prepareImmutableTurnCommit({
      store,
      plan,
      event: delta.turnTransition,
      messages,
      now: () => input.committedAt,
      createEventId: randomUUID,
    });
    result.turnTransition = prepared;
    if (!prepared.applied) return { abort: true, changes: plan.changes(), result };
  } else if (messages.length) {
    result.messages = await prepareImmutableMessages({
      store,
      plan,
      messages,
      updatedAt: input.committedAt,
    });
  }
}

async function prepareMessageUpdates({ store, plan, input, replayedMessageUids, result }) {
  const delta = input.changes;
  const appends = (delta.messageContentAppends ?? []).filter(
    (message) => !replayedMessageUids.has(message.messageUid),
  );
  const metadataUpdates = (delta.messageMetadataUpdates ?? []).filter(
    (message) => !replayedMessageUids.has(message.messageUid),
  );
  if (appends.length || metadataUpdates.length) {
    const appended = await prepareImmutableMessageUpdates({
      store,
      plan,
      appends,
      metadataUpdates,
      committedAt: input.committedAt,
    });
    result.messages = [...(result.messages ?? []), ...appended.messages];
  }
}

async function prepareCheckpoints({
  store,
  plan,
  input,
  duplicateCheckpoints,
  result,
  generation,
}) {
  const delta = input.changes;
  result.summaryCheckpoints = [];
  for (const checkpoint of delta.summaryCheckpoints ?? []) {
    const duplicate = duplicateCheckpoints.get(checkpoint);
    const prepared =
      duplicate ??
      (await prepareImmutableSummaryCheckpoint({
        store,
        plan,
        checkpoint,
        committedAt: input.committedAt,
      }));
    result.summaryCheckpoints.push({
      ...prepared,
      ...(prepared.deduplicated === true && !duplicate ? { originGeneration: generation + 1 } : {}),
      turnScopeId: checkpoint.turnScopeId,
      messages: immutableCheckpointMessageResult(checkpoint),
    });
  }
}

async function prepareDeliveryChanges({ store, plan, input, result }) {
  const { sessionId } = store;
  const delta = input.changes;
  result.events = [];
  for (const event of delta.artifactEvents ?? []) {
    result.events.push(await prepareArtifactEvent(store, plan, event));
  }
  await prepareTimings(plan, delta.timings ?? []);
  result.deliveries = await prepareImmutableDeliveries(plan, delta.deliveries ?? [], sessionId);
  result.outboxCursors = await prepareImmutableOutboxCursors(
    plan,
    delta.outboxCursors ?? [],
    sessionId,
  );
  if (delta.outboxMaintenance)
    result.outboxMaintenance = await prepareImmutableOutboxMaintenance(
      store,
      plan,
      delta.outboxMaintenance,
      sessionId,
    );
}

async function prepareSessionMetadata({ plan, read, input, messages }) {
  const delta = input.changes;
  const metadata = await read("metadata", "session");
  if (delta.scopedMetadata)
    plan.set("metadata", "scoped", createScopedSessionMetadataRecord(delta.scopedMetadata));
  if (delta.sessionMetadata) {
    plan.set(
      "metadata",
      "session",
      applySessionSettings(metadata, delta.sessionMetadata, input.committedAt),
    );
  } else if (
    delta.turnTransition ||
    messages.length ||
    delta.artifactEvents?.length ||
    delta.timings?.length
  ) {
    plan.set("metadata", "session", { ...metadata, updatedAt: input.committedAt });
  }
}
