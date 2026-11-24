/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, stableValue } from "@noobot/shared/value";
import { isSessionCaller } from "@noobot/shared/session-caller";
import { isSessionAggregateVersion } from "./command/session-command.js";
import { isCanonicalMessageTimestamp } from "./message-entity-contract.js";
import { assertSessionScopeIdentity, SESSION_ERROR_CODE } from "./errors.js";
import { requireSessionSettings } from "./aggregate/session-settings.js";
import { assertNoRetiredSessionFields } from "./aggregate/session-invariants.js";
import { requirePartitionCollection } from "./partition-collections.js";
import { PARTITION_HISTORICAL_OPERATIONS } from "./partition-collection-names.js";
import {
  assertHistoricalOperationRetryMatches,
  requirePartitionHistoricalOperation,
} from "./partition-storage-history.js";
import { storageDigest } from "#storage-digest";
import { requirePartitionEntityPageKey } from "./partition-entity-page-budget.js";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
  partitionTransactionJsonBudget,
  requirePartitionJournalReference,
  requirePartitionRequestPosition,
  serializePartitionTransactionValue,
} from "./partition-journal.js";
import {
  captureSessionTransactionInput,
  prepareScopedSessionCommitRequest,
  requireSessionOperationId,
} from "./session-changes.js";
import { requireSessionRequestDigest, sessionRequestDigest } from "./session-request-digest.js";
import { isPartitionEntityOwner } from "./message-creation-owner.js";
import {
  partitionTransactionPosition,
  requirePartitionTransactionPosition,
} from "./partition-transaction-position.js";
export { samePartitionEntityOwner } from "./message-creation-owner.js";
export { PARTITION_HISTORICAL_OPERATIONS } from "./partition-collection-names.js";
export { PARTITION_TRANSACTION_FORMAT } from "./partition-transaction-position.js";

export function projectVisiblePartitionMutation(mutation) {
  return mutation?.remove === true ? null : mutation;
}

export function createPartitionMutationReader(readEntries) {
  return async ({ collection, keys, includeOwner }) => {
    const entries = await readEntries({ collection, keys });
    if (includeOwner) return entries;
    for (const [key, entry] of entries)
      entries.set(key, projectVisiblePartitionMutation(entry === null ? null : entry.mutation));
    return entries;
  };
}

export const PARTITION_SESSION_METADATA = Object.freeze({ collection: "metadata", key: "session" });

const SESSION_COLLECTION_FACT_FIELDS = Object.freeze([
  "messages",
  "dialogOrder",
  "turnTimings",
  "sessionArtifactEvents",
  "turnLifecycle",
  "turnSummaryCheckpoints",
]);

export function partitionHistoricalOperationAddress(operationId) {
  return {
    collection: PARTITION_HISTORICAL_OPERATIONS,
    key: storageDigest(JSON.stringify(requireSessionOperationId(operationId))),
  };
}

export function createPartitionHistoricalOperationMutation(evidence) {
  const value = requirePartitionHistoricalOperation(evidence, evidence?.operationId);
  return { ...partitionHistoricalOperationAddress(value.operationId), owner: null, value };
}

export function preparePartitionHistoricalOperationImport(snapshot, evidence) {
  const value = captureSessionTransactionInput(evidence);
  const mutation = createPartitionHistoricalOperationMutation(value);
  const historicalEvidenceDigest = storageDigest(JSON.stringify(stableValue(value)));
  return {
    request: {
      epoch: snapshot.epoch,
      expectedGeneration: snapshot.sequence,
      operationId: value.operationId,
      input: { historicalEvidenceDigest },
    },
    prepared: { action: "commit", mutations: [mutation], result: null },
  };
}

function requireHistoricalOperationMutation(mutation, operationId) {
  if (
    mutation.collection !== PARTITION_HISTORICAL_OPERATIONS ||
    mutation.owner !== null ||
    Object.hasOwn(mutation, "remove") ||
    mutation.key !== partitionHistoricalOperationAddress(operationId).key
  )
    throw new TypeError("Historical operation evidence requires its own creation identity");
  return requirePartitionHistoricalOperation(mutation.value, operationId);
}

export function assertPartitionHistoricalOperationEvidence(mutation, evidence) {
  const expected = requirePartitionHistoricalOperation(evidence, evidence?.operationId);
  const actual = requireHistoricalOperationMutation(mutation, expected.operationId);
  if (JSON.stringify(stableValue(actual)) !== JSON.stringify(stableValue(expected)))
    throw partitionJournalError(
      "SESSION_MIGRATION_SOURCE_CHANGED",
      `Staged receipt differs from the source: ${expected.operationId}`,
    );
}

export function rejectPartitionHistoricalOperation(mutation, operationId) {
  if (mutation === null) return;
  const { receipt } = requireHistoricalOperationMutation(mutation, operationId);
  throw Object.assign(
    new PartitionAdmissionRejection(
      "SESSION_OPERATION_RETRY_UNAVAILABLE",
      "Historical operation has no partition retry position; it was not re-executed",
    ),
    { operationId, sourceGeneration: receipt.generation },
  );
}

export function replayPartitionHistoricalOperation(mutation, { operationId, requestDigest }) {
  if (mutation === null)
    throw new PartitionAdmissionRejection(
      "SESSION_REQUEST_EPOCH",
      "The original request was not committed before migration",
    );
  const { receipt } = requireHistoricalOperationMutation(mutation, operationId);
  try {
    assertHistoricalOperationRetryMatches(receipt, operationId, requestDigest);
  } catch (error) {
    throw Object.assign(new PartitionAdmissionRejection(error.code, error.message), error);
  }
  return {
    generation: receipt.generation,
    commit: receipt.commit,
    replayed: true,
    ...(Object.hasOwn(receipt, "result") ? { result: structuredClone(receipt.result) } : {}),
  };
}

export const PARTITION_LIFECYCLE_HEADER = Object.freeze({
  collection: "metadata",
  key: "lifecycle",
});

export function requirePartitionOutboxTail(header) {
  const value = header?.outboxTail;
  if (!Number.isSafeInteger(value) || value < 0)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Missing or invalid partition outbox tail",
    );
  return value;
}

function hasSessionScope(value) {
  return (
    isCanonicalText(value?.sessionId) &&
    (value.parentSessionId === "" || isCanonicalText(value.parentSessionId))
  );
}

export function capturePartitionSessionScope(scope) {
  if (!hasSessionScope(scope))
    throw new TypeError("Partition session scope requires session and parent identity");
  const { sessionId, parentSessionId } = scope;
  return Object.freeze({ sessionId, parentSessionId });
}

export function assertPartitionSessionScope(snapshot, session, scope) {
  if (!hasSessionScope(session) || session.sessionId !== snapshot.sessionId)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid published partition session metadata",
    );
  try {
    assertSessionScopeIdentity({ ...scope, session });
  } catch (cause) {
    if (cause.code !== SESSION_ERROR_CODE.SCOPE_IDENTITY_CONFLICT) throw cause;
    throw Object.assign(new PartitionAdmissionRejection(cause.code, cause.message), {
      cause,
      statusCode: cause.statusCode,
      sessionId: cause.sessionId,
    });
  }
}

export function assertPartitionStoredSessionMetadata(snapshot, session, scope) {
  assertPartitionSessionScope(snapshot, session, scope);
  if (
    !isSessionAggregateVersion(session.aggregateVersion) ||
    !isSessionCaller(session.caller) ||
    !isCanonicalMessageTimestamp(session.createdAt) ||
    !isCanonicalMessageTimestamp(session.updatedAt)
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Published partition metadata contains invalid session facts",
    );
  try {
    requireSessionSettings(session);
    assertNoRetiredSessionFields(session);
  } catch (cause) {
    if (cause.code !== "SESSION_COMMIT_INPUT_INVALID" && cause.code !== "SESSION_PROTOCOL_INVALID")
      throw cause;
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
  const duplicated = SESSION_COLLECTION_FACT_FIELDS.find((field) => Object.hasOwn(session, field));
  if (duplicated)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      `Published partition metadata contains collection fact:${duplicated}`,
    );
  if (Object.hasOwn(session, "autoTitle"))
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Published partition metadata contains derived autoTitle",
    );
}

function assertPreparedSessionMetadata(snapshot, mutation, scope) {
  try {
    assertPartitionStoredSessionMetadata(
      snapshot,
      mutation.remove === true ? null : mutation.value,
      scope,
    );
  } catch (cause) {
    if (
      cause.code !== "SESSION_STORAGE_CORRUPT" &&
      cause.code !== SESSION_ERROR_CODE.SCOPE_IDENTITY_CONFLICT
    )
      throw cause;
    throw Object.assign(
      new PartitionAdmissionRejection(
        "SESSION_PUBLICATION_CONTRACT",
        "Prepared session metadata violates the storage contract",
      ),
      { cause },
    );
  }
}

export function assertPartitionSessionMetadataMutations(snapshot, mutations, scope) {
  const { collection, key } = PARTITION_SESSION_METADATA;
  for (const mutation of mutations) {
    if (mutation.collection === collection && mutation.key === key)
      assertPreparedSessionMetadata(snapshot, mutation, scope);
  }
}

function requireFields(value, fields, label) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  )
    throw new TypeError(`Invalid ${label} fields`);
  for (const field of fields)
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, field), "value"))
      throw new TypeError(`${label} requires data properties`);
}

export function partitionEntityKey(collection, key) {
  requirePartitionCollection(collection);
  if (typeof key !== "string" || !key) throw new TypeError("Entity key is required");
  const identity = JSON.stringify([collection, key]);
  requirePartitionEntityPageKey(identity);
  return identity;
}

export function partitionEntityCollectionRange(collection) {
  const tuple = partitionEntityKey(collection, "0");
  const prefix = tuple.slice(0, tuple.lastIndexOf(","));
  return { start: `${prefix},`, end: `${prefix}-` };
}

export function requirePartitionMutationIdentity(mutation, sequence) {
  const removing = Object.hasOwn(mutation, "remove");
  requireFields(
    mutation,
    ["collection", "key", "owner", removing ? "remove" : "value"],
    "mutation",
  );
  const identity = partitionEntityKey(mutation.collection, mutation.key);
  if (removing ? mutation.remove !== true : mutation.value === undefined)
    throw new TypeError("Mutation requires a JSON value or explicit removal");
  if (mutation.owner !== null) requirePartitionEntityOwner(mutation.owner, sequence - 1);
  return identity;
}

export function requirePartitionTransaction(transaction, sequence) {
  requireFields(
    transaction,
    ["format", "expectedGeneration", "operationId", "requestDigest", "mutations", "result"],
    "partition transaction",
  );
  requirePartitionTransactionPosition(transaction, sequence);
  if (!Array.isArray(transaction.mutations) || transaction.result === undefined)
    throw new TypeError("Transaction requires a mutation array and an explicit result");
  requireSessionOperationId(transaction.operationId);
  requireSessionRequestDigest(transaction.requestDigest);
  const seen = new Set();
  for (const mutation of transaction.mutations) {
    const identity = requirePartitionMutationIdentity(mutation, sequence);
    if (mutation.collection === PARTITION_HISTORICAL_OPERATIONS)
      requireHistoricalOperationMutation(mutation, transaction.operationId);
    if (seen.has(identity)) throw new TypeError("Duplicate transaction mutation");
    seen.add(identity);
  }
  return transaction;
}

export function requirePartitionEntityOwner(owner, publishedSequence) {
  if (!isPartitionEntityOwner(owner)) throw new TypeError("Invalid partition entity owner");
  if (owner.sequence > publishedSequence)
    throw new RangeError("Entity owner exceeds publication boundary");
  return owner;
}

export function createPartitionEntityOwner({ epoch, partition, sequence }, slot) {
  return requirePartitionEntityOwner({ epoch, partition, sequence, slot }, sequence);
}

export function partitionMutationOwner(owner, { record, slot }) {
  return owner === null ? createPartitionEntityOwner(record, slot) : owner;
}

export function requirePartitionEntityReference(reference, snapshot) {
  requireFields(reference, ["record", "slot"], "partition entity reference");
  requirePartitionJournalReference(reference.record, snapshot);
  if (!Number.isSafeInteger(reference.slot) || reference.slot < 0)
    throw new TypeError("Invalid entity mutation slot");
  return reference;
}

export function preparePartitionSessionCommitRequest(snapshot, command) {
  const { epoch, sequence: expectedGeneration } = snapshot;
  requirePartitionRequestPosition({ epoch, sequence: expectedGeneration + 1 });
  return prepareScopedSessionCommitRequest(
    { epoch, expectedGeneration },
    command,
    partitionTransactionJsonBudget(snapshot.limits),
  );
}

function capturePartitionRequestEnvelope(request, limits) {
  requireFields(request, ["epoch", "expectedGeneration", "operationId", "input"], "operation");
  const { epoch, expectedGeneration, operationId, input } = request;
  if (
    !Number.isSafeInteger(expectedGeneration) ||
    expectedGeneration < 0 ||
    expectedGeneration >= Number.MAX_SAFE_INTEGER ||
    input === undefined
  )
    throw new TypeError("Operation requires its expected generation and input");
  if (epoch !== null) requirePartitionRequestPosition({ epoch, sequence: expectedGeneration + 1 });
  requireSessionOperationId(operationId);
  const capturedInput = captureSessionTransactionInput(
    input,
    partitionTransactionJsonBudget(limits),
  );
  return Object.freeze({ epoch, expectedGeneration, operationId, input: capturedInput });
}

export function capturePartitionTransactionRequest(request, limits) {
  const captured = capturePartitionRequestEnvelope(request, limits);
  const { epoch, expectedGeneration, operationId, input } = captured;
  const identity = {
    epoch,
    sequence: expectedGeneration + 1,
    operationId,
    requestDigest: sessionRequestDigest(expectedGeneration, input),
  };
  return { identity, request: captured };
}

export function matchesPartitionTransactionRequest(receipt, { operationId, requestDigest }) {
  const transaction = requirePartitionTransaction(receipt.payload, receipt.sequence);
  return transaction.operationId === operationId && transaction.requestDigest === requestDigest;
}

export function createPartitionTransactionRequest(identity, prepared) {
  requireFields(prepared, ["action", "mutations", "result"], "prepared transaction");
  if (prepared.action !== "commit") throw new TypeError("Expected a prepared commit");
  const { epoch, sequence, operationId, requestDigest } = identity;
  const { mutations, result } = prepared;
  const payload = {
    ...partitionTransactionPosition(sequence),
    operationId,
    requestDigest,
    mutations,
    result,
  };
  return { epoch, sequence, payload };
}

export function planPartitionTransaction(identity, prepared, limits) {
  if (!prepared || Object.getOwnPropertyDescriptor(prepared, "action")?.value !== "abort")
    return { request: createPartitionTransactionRequest(identity, prepared) };
  requireFields(prepared, ["action", "result"], "prepared abort");
  const result = JSON.parse(serializePartitionTransactionValue(prepared.result, limits));
  return {
    aborted: {
      status: "aborted",
      generation: identity.sequence - 1,
      reference: null,
      replayed: false,
      result,
      mutations: [],
    },
  };
}

export function createPartitionTransactionOutcome(receipt, projectResult) {
  if (Object.hasOwn(receipt, "aborted")) return receipt.aborted;
  if (Object.hasOwn(receipt, "historical")) return receipt.historical;
  const transaction = receipt.payload;
  requirePartitionTransaction(transaction, receipt.sequence);
  const outcome = {
    status: "committed",
    generation: receipt.sequence,
    reference: receipt.reference,
    replayed: receipt.replayed,
    result: transaction.result,
    mutations: transaction.mutations.map(({ collection, key, owner }, slot) => {
      const reference = { record: receipt.reference, slot };
      return { collection, key, owner: partitionMutationOwner(owner, reference), reference };
    }),
  };
  if (projectResult) outcome.result = projectResult(outcome, transaction.mutations);
  return outcome;
}
