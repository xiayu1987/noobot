/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { PARTITION_CONTEXT_ROOT } from "./partition-context-index.js";
import { PARTITION_TITLE_CANDIDATES_ROOT } from "./partition-title-index.js";
import { SESSION_ERROR_CODE } from "./errors.js";
import { requireSessionInitialization } from "./session-initialization.js";
import {
  assertPartitionSessionMetadataMutations,
  assertPartitionStoredSessionMetadata,
  capturePartitionTransactionRequest,
  PARTITION_LIFECYCLE_HEADER,
  PARTITION_SESSION_METADATA,
} from "./partition-transaction.js";
import { PARTITION_SESSION_MESSAGE_COUNT } from "./partition-session-messages.js";
import {
  PARTITION_DIALOG_SEQUENCE,
  PARTITION_SCOPED_METADATA,
  requirePartitionDialogSequence,
} from "./partition-session-state.js";
import { createScopedSessionMetadataRecord } from "./aggregate/scoped-session-metadata.js";
import { PartitionAdmissionRejection, partitionJournalError } from "./partition-journal.js";
import {
  createLifecycleIndexDescriptor,
  LIFECYCLE_INDEX_DESCRIPTOR,
} from "./lifecycle-terminal-index.js";

export function capturePartitionSessionInitializationRequest(
  snapshot,
  { operationId, session, scopedMetadata, initialTurn = null },
) {
  return capturePartitionTransactionRequest(
    {
      epoch: snapshot.epoch,
      expectedGeneration: 0,
      operationId,
      input: { session, scopedMetadata, initialTurn },
    },
    snapshot.limits,
  ).request;
}

export function isUnpublishedPartitionSession(snapshot, session, sessionId) {
  if (snapshot.sequence !== 0 || session !== null) return false;
  if (snapshot.sessionId !== sessionId)
    throw new PartitionAdmissionRejection(
      "SESSION_STORAGE_IDENTITY",
      "Session initialization scope does not match journal",
    );
  return true;
}

export function assertPartitionInitializationScope(snapshot, session, scope) {
  if (isUnpublishedPartitionSession(snapshot, session, scope.sessionId)) return;
  assertPartitionStoredSessionMetadata(snapshot, session, scope);
}

function requireInitialization(snapshot, input, scope) {
  try {
    return requireSessionInitialization(input, {
      sessionId: snapshot.sessionId,
      parentSessionId: scope.parentSessionId,
    });
  } catch (cause) {
    if (
      cause.code !== "SESSION_PROTOCOL_INVALID" &&
      cause.code !== "SESSION_COMMIT_INPUT_INVALID" &&
      cause.code !== SESSION_ERROR_CODE.SCOPE_IDENTITY_CONFLICT
    )
      throw cause;
    throw Object.assign(new PartitionAdmissionRejection(cause.code, cause.message), {
      cause,
      ...(cause.code === SESSION_ERROR_CODE.SCOPE_IDENTITY_CONFLICT
        ? { statusCode: cause.statusCode, sessionId: cause.sessionId }
        : {}),
    });
  }
}

function requireEmptyGeneration(generation) {
  if (generation !== 0)
    throw new PartitionAdmissionRejection(
      "SESSION_ENTITY_EXISTS",
      "Session is already initialized",
    );
}

export function preparePartitionSessionInitialization(snapshot, generation, input, scope) {
  requireEmptyGeneration(generation);
  if (
    !isPlainObject(input) ||
    Object.keys(input).length !== 3 ||
    !Object.hasOwn(input, "session") ||
    !Object.hasOwn(input, "scopedMetadata") ||
    !Object.hasOwn(input, "initialTurn")
  )
    throw new PartitionAdmissionRejection(
      "SESSION_COMMIT_INPUT_INVALID",
      "Session initialization requires a session aggregate",
    );
  const { metadata } = requireInitialization(snapshot, input, scope);
  return seedEmptyPartitionSession(snapshot, scope, {
    metadata,
    scopedMetadata: input.scopedMetadata,
    dialogSequence: 0,
  });
}

export function preparePartitionSessionImport(
  snapshot,
  generation,
  { metadata, scopedMetadata, dialogSequence },
  scope,
) {
  requireEmptyGeneration(generation);
  return seedEmptyPartitionSession(snapshot, scope, {
    metadata,
    scopedMetadata,
    dialogSequence: requirePartitionDialogSequence(dialogSequence),
  });
}

function seedEmptyPartitionSession(snapshot, scope, { metadata, scopedMetadata, dialogSequence }) {
  const metadataMutation = { ...PARTITION_SESSION_METADATA, owner: null, value: metadata };
  assertPartitionSessionMetadataMutations(snapshot, [metadataMutation], scope);
  let scopedRecord;
  try {
    scopedRecord = createScopedSessionMetadataRecord(scopedMetadata);
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw Object.assign(
      new PartitionAdmissionRejection("SESSION_COMMIT_INPUT_INVALID", cause.message),
      { cause },
    );
  }
  return {
    action: "commit",
    mutations: [
      metadataMutation,
      { ...PARTITION_SCOPED_METADATA, owner: null, value: scopedRecord },
      { ...PARTITION_SESSION_MESSAGE_COUNT, owner: null, value: 0 },
      { ...PARTITION_DIALOG_SEQUENCE, owner: null, value: dialogSequence },
      { ...PARTITION_CONTEXT_ROOT, owner: null, value: { ordinals: [] } },
      { ...PARTITION_TITLE_CANDIDATES_ROOT, owner: null, value: { ordinals: [] } },
      { ...LIFECYCLE_INDEX_DESCRIPTOR, owner: null, value: createLifecycleIndexDescriptor(null) },
      {
        ...PARTITION_LIFECYCLE_HEADER,
        owner: null,
        value: {
          sequence: 0,
          activeTurnScopeId: "",
          outboxTail: 0,
        },
      },
    ],
    result: { sessionId: metadata.sessionId, parentSessionId: metadata.parentSessionId },
  };
}

export function projectPartitionSessionInitialization(outcome, mutations) {
  const metadata = mutations.find(
    ({ collection, key }) =>
      collection === PARTITION_SESSION_METADATA.collection &&
      key === PARTITION_SESSION_METADATA.key,
  )?.value;
  if (
    !metadata ||
    metadata.sessionId !== outcome.result?.sessionId ||
    metadata.parentSessionId !== outcome.result?.parentSessionId
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid committed session initialization",
    );
  return { metadata };
}
