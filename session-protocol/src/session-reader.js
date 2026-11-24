/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { isCanonicalText, isFunction, isPlainObject } from "@noobot/shared/value";
import {
  UNSUPPORTED_SESSION_STORAGE,
  requirePartitionPublicationSource,
} from "./session-storage-format.js";
import { isPartitionEpoch } from "./partition-epoch.js";
import { PARTITION_JOURNAL_HEAD_FILE, exactObject } from "./partition-journal-fields.js";
import { isSessionCaller } from "@noobot/shared/session-caller";
import { assertSessionScopeIdentity, createSessionNotFoundError } from "./errors.js";

export function assertScopedSessionReadIdentity(
  metadata,
  { userId, authoritySessionId, sessionId },
) {
  if (
    ![userId, authoritySessionId].every(isCanonicalText) ||
    (sessionId !== null && !isCanonicalText(sessionId))
  )
    throw new TypeError("Invalid scoped session read identity");
  if (
    metadata.parentSessionId !== authoritySessionId ||
    (sessionId !== null && metadata.sessionId !== sessionId)
  )
    throw createSessionNotFoundError({ userId, sessionId: sessionId ?? "" });
}
export {
  isFinalDisplayAssistantSource,
  planSessionDisplayRows,
  resolveSessionDisplayAssistant,
  sessionDisplayRowOrderKey,
} from "./session-display-rows.js";
export {
  emptySessionDisplayOrderPage,
  encodeSessionDisplayOrderKey,
  readSessionDisplayOrderWindow,
  updateSessionDisplayOrder,
} from "./session-display-order-index.js";
export {
  createSessionDisplayArtifactSummary,
  sessionDisplayArtifactMemberKey,
  sessionDisplayArtifactResultKey,
  sessionDisplayArtifactStateKey,
  sessionDisplayAssistantCountKey,
  sessionDisplayDependencyDirectory,
} from "./session-display-dependencies.js";
export {
  createSessionDisplayPublicationRow,
  describeSessionDisplayMessageRow,
  readSessionDisplayPublicationWindow,
  sessionDisplayMessageProjection,
  stageSessionDisplayPublication,
} from "./session-display-publication.js";
export {
  applySessionDisplayRowDelta,
  applySessionDisplaySourceDelta,
  createSessionDisplayStats,
  createSessionDisplayPage,
  emptySessionDisplayRowCounts,
  emptySessionDisplaySourceCounts,
  planSessionDisplayPage,
  readSessionDisplayPage,
  requireRetainedSessionDisplayPageRequest,
  requireRetainedSessionDisplayPageResponse,
  requireSessionDisplayPageRelease,
  requireSessionDisplayPageSelection,
  requireSessionDisplayPageTransition,
  requireSessionDisplaySourceCounts,
  requireSessionDisplayStats,
  sessionDisplayMessageContribution,
  sessionDisplayRowContribution,
} from "./session-display-page.js";

export function createSessionJournalLease({ journal, release }) {
  if (!journal || !isFunction(release))
    throw new TypeError("Journal lease requires a journal and release operation");
  let completion;
  const close = () => {
    if (!completion)
      completion = Promise.resolve()
        .then(release)
        .catch((cause) => {
          completion = undefined;
          throw cause;
        });
    return completion;
  };
  return Object.freeze({ journal, release: close, [Symbol.asyncDispose]: close });
}

export const PARTITION_MIGRATION_AUTHORITY = Object.freeze({
  directory: "partition-session",
  scratchSuffix: ".partition-migration-work",
  file: "session-authority",
  format: "noobot.partition-session-authority/1",
  maxBytes: LENGTH_THRESHOLDS.partitionStorage.migrationAuthorityRecordBytes,
});

export const PARTITION_MIGRATION_BUSINESS_CHECKPOINT = Object.freeze({
  file: "business-verified",
  format: "noobot.partition-migration-business-checkpoint/1",
  maxBytes: PARTITION_MIGRATION_AUTHORITY.maxBytes,
});

function partitionMigrationAuthorityError(message, cause) {
  return Object.assign(new Error(message, { cause }), { code: "SESSION_STORAGE_CORRUPT" });
}

function capturePartitionMigrationRecord(record, contract) {
  exactObject(record, ["format", "source", "target"], contract.format);
  const { format, target } = record;
  const source = requirePartitionPublicationSource(record.source);
  exactObject(target, ["sessionId", "epoch", "generation"], "partition migration target");
  if (
    format !== contract.format ||
    target.sessionId !== source.sessionId ||
    !isPartitionEpoch(target.epoch) ||
    !Number.isSafeInteger(target.generation) ||
    target.generation < 1
  )
    throw new TypeError("Invalid partition migration identity");
  return { format, source, target };
}

function encodePartitionMigrationRecord({ source, target }, contract) {
  const record = capturePartitionMigrationRecord(
    { format: contract.format, source, target },
    contract,
  );
  const bytes = Buffer.from(JSON.stringify(record));
  if (bytes.length > contract.maxBytes)
    throw new RangeError(`${contract.format} exceeds its protocol bound`);
  return bytes;
}

function decodePartitionMigrationRecord(bytes, contract) {
  try {
    if (bytes.length > contract.maxBytes)
      throw new RangeError(`${contract.format} exceeds its protocol bound`);
    return capturePartitionMigrationRecord(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      contract,
    );
  } catch (cause) {
    throw partitionMigrationAuthorityError(`Invalid ${contract.format} record`, cause);
  }
}

export function encodePartitionMigrationAuthority(receipt) {
  return encodePartitionMigrationRecord(receipt, PARTITION_MIGRATION_AUTHORITY);
}

export function decodePartitionMigrationAuthority(bytes) {
  return decodePartitionMigrationRecord(bytes, PARTITION_MIGRATION_AUTHORITY);
}

export function encodePartitionMigrationBusinessCheckpoint(checkpoint) {
  return encodePartitionMigrationRecord(checkpoint, PARTITION_MIGRATION_BUSINESS_CHECKPOINT);
}

export function decodePartitionMigrationBusinessCheckpoint(bytes) {
  return decodePartitionMigrationRecord(bytes, PARTITION_MIGRATION_BUSINESS_CHECKPOINT);
}

export function assertPartitionMigrationBusinessCheckpointTarget({ target }, head) {
  assertPartitionMigrationTarget(
    target,
    head,
    "Journal does not match the verified business checkpoint",
  );
}

function assertPartitionMigrationTarget(
  target,
  head,
  message = "Journal does not match the published migration target",
) {
  if (
    head.sessionId !== target.sessionId ||
    head.epoch !== target.epoch ||
    head.sequence < target.generation
  )
    throw partitionMigrationAuthorityError(message);
}

export function partitionMigrationPublicationUncertain(cause) {
  return Object.assign(
    new Error(
      "Migration publication is not durable-confirmed; retry with the same source identity",
      {
        cause,
      },
    ),
    { code: "SESSION_MIGRATION_PUBLICATION_UNCERTAIN" },
  );
}

export const SESSION_DOCUMENT_FILE = "session.json";

async function missingAuthorityFile(operation, missing) {
  try {
    return await operation();
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
    return missing;
  }
}

export async function readSessionStorageAuthorityFacts({ stat, readPrefix }) {
  const present = (file) => missingAuthorityFile(async () => Boolean(await stat(file)), false);
  const [partition, head, format, document, migration] = await Promise.all([
    present(PARTITION_JOURNAL_HEAD_FILE),
    present(UNSUPPORTED_SESSION_STORAGE.head),
    present(UNSUPPORTED_SESSION_STORAGE.format),
    present(SESSION_DOCUMENT_FILE),
    missingAuthorityFile(() =>
      readPrefix(PARTITION_MIGRATION_AUTHORITY.file, PARTITION_MIGRATION_AUTHORITY.maxBytes + 1),
    ),
  ]);
  return { partition, immutable: head || format, format, document, migration };
}

export async function readPartitionAuthorityPublication(migration, readHead) {
  const publication = migration === undefined ? null : decodePartitionMigrationAuthority(migration);
  const directory = publication ? [PARTITION_MIGRATION_AUTHORITY.directory] : [];
  let head;
  try {
    head = await readHead(directory);
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
    throw partitionMigrationAuthorityError(
      publication ? "Published migration target is missing" : "Published partition head is missing",
      cause,
    );
  }
  if (publication === null) return { head, receipt: null };
  const { source, target } = publication;
  assertPartitionMigrationTarget(target, head);
  return { head, receipt: { source, target } };
}

export function resolveSessionStorageAuthority({ partition, immutable, document, migration }) {
  if (![partition, immutable, document].every((present) => typeof present === "boolean"))
    throw new TypeError("Session authority requires explicit storage presence facts");
  if (migration !== undefined) {
    if (partition)
      throw partitionMigrationAuthorityError("Session has multiple partition storage authorities");
    decodePartitionMigrationAuthority(migration);
    return "partition";
  }
  if (partition && (immutable || document))
    throw Object.assign(new Error("Session has multiple storage authorities"), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  if (partition) return "partition";
  if (immutable || document) return "immutable";
  return null;
}

export function inspectSessionStorageAuthority(facts) {
  try {
    const authority = resolveSessionStorageAuthority(facts);
    const format =
      authority === "immutable" ? (facts.immutable ? "immutable" : "document") : authority;
    return { authority, format, error: null };
  } catch (error) {
    if (error.code !== "SESSION_STORAGE_CORRUPT") throw error;
    const conflicting =
      facts.partition && (facts.immutable || facts.document || facts.migration !== undefined);
    return { authority: null, format: conflicting ? "conflicting" : "partition", error };
  }
}

export function requirePartitionSessionAuthority(facts) {
  const authority = resolveSessionStorageAuthority(facts);
  if (authority === "immutable")
    throw Object.assign(new Error("Session storage format is no longer supported"), {
      code: "SESSION_STORAGE_FORMAT_UNSUPPORTED",
    });
  return authority === "partition";
}

export async function planSessionOutboxMutation({ generation, methods }, plan) {
  await using reader = createSessionReaderLifecycle({
    generation,
    methods,
    release: async () => {},
  });
  const complete = await plan(reader);
  if (!isFunction(complete)) throw new TypeError("Outbox plan requires a completion operation");
  return complete;
}

export function createSessionReaderAccess({
  create,
  open,
  openArtifact,
  withCommit,
  withOutboxMutation,
  withMutation,
  withRemoval,
  readPlacement,
  recover,
}) {
  if (
    !isFunction(create) ||
    !isFunction(open) ||
    !isFunction(openArtifact) ||
    !isFunction(withCommit) ||
    !isFunction(withOutboxMutation) ||
    !isFunction(withMutation) ||
    !isFunction(withRemoval) ||
    !isFunction(readPlacement) ||
    !isFunction(recover)
  )
    throw new TypeError(
      "Session reader access requires create, open, openArtifact, withCommit, withOutboxMutation, withMutation, withRemoval, readPlacement and recover operations",
    );
  return Object.freeze({
    async create(scope, initialization) {
      assertSessionScopeIdentity({
        session: initialization.session,
        sessionId: scope.sessionId,
        parentSessionId: scope.parentSessionId,
      });
      return create(scope, initialization);
    },
    open,
    openArtifact,
    withCommit,
    withOutboxMutation,
    withMutation,
    withRemoval,
    recover,
    async readPlacement(scope) {
      const session = await readPlacement(scope);
      if (session === null) return null;
      if (scope.sessionId !== undefined || scope.parentSessionId !== undefined)
        assertSessionScopeIdentity({
          session,
          sessionId: scope.sessionId,
          parentSessionId: Object.hasOwn(scope, "parentSessionId")
            ? scope.parentSessionId
            : session.parentSessionId,
        });
      if (!isCanonicalText(session.sessionId) || !isSessionCaller(session.caller))
        throw Object.assign(new Error("Invalid stored session placement"), {
          code: "SESSION_STORAGE_CORRUPT",
        });
      return Object.freeze({
        sessionId: session.sessionId,
        parentSessionId: session.parentSessionId,
        caller: session.caller,
      });
    },
  });
}

export function requireStoredSessionTurnMembership(turn) {
  if (
    !isPlainObject(turn) ||
    !isCanonicalText(turn.dialogProcessId) ||
    !Number.isSafeInteger(turn.messageCount) ||
    turn.messageCount < 1
  )
    throw Object.assign(new Error("Invalid stored turn descriptor"), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  return turn;
}

export function projectSessionTurnDescriptor(turnScopeId, turn) {
  if (!isCanonicalText(turnScopeId))
    throw new TypeError("Turn descriptor requires a canonical scope ID");
  if (turn === null) return null;
  requireStoredSessionTurnMembership(turn);
  return { turnScopeId, dialogProcessId: turn.dialogProcessId, messageCount: turn.messageCount };
}

export function requireSessionExecutionSource(source) {
  exactObject(source, ["sessionId", "parentSessionId", "turns"], "session execution source");
  if (
    !isCanonicalText(source.sessionId) ||
    !(source.parentSessionId === "" || isCanonicalText(source.parentSessionId)) ||
    !Array.isArray(source.turns)
  )
    throw new TypeError("Invalid session execution source");
  return source;
}

export function createSessionReaderLifecycle({ generation, methods, release }) {
  if (!Number.isSafeInteger(generation) || generation < 1 || !isFunction(release))
    throw new TypeError("Session reader requires a generation and release operation");
  let closing = false;
  let closePromise;
  let disposal;
  let active = 0;
  let drained;
  const finish = async (scopeExit) => {
    closing = true;
    if (active)
      await new Promise((resolve) => {
        drained = resolve;
      });
    await release({ scopeExit });
  };
  const close = () => {
    if (disposal) return disposal;
    closePromise ??= finish(false).catch((error) => {
      closePromise = undefined;
      throw error;
    });
    return closePromise;
  };
  const dispose = () => {
    disposal ??= closePromise
      ? closePromise.catch(async (failure) => {
          try {
            await finish(true);
          } catch (cause) {
            throw new AggregateError([failure, cause], "Session reader disposal failed", {
              cause: failure,
            });
          }
          throw failure;
        })
      : finish(true);
    return disposal;
  };
  const reader = { generation, close, [Symbol.asyncDispose]: dispose };
  for (const [name, method] of Object.entries(methods)) {
    if (!isFunction(method) || Object.hasOwn(reader, name))
      throw new TypeError("Invalid session reader operation");
    reader[name] = async (...args) => {
      if (closing)
        throw Object.assign(new Error("Session reader is closed"), {
          code: "SESSION_READER_CLOSED",
        });
      active += 1;
      try {
        return await method(...args);
      } finally {
        active -= 1;
        if (!active) drained?.();
      }
    };
  }
  return Object.freeze(reader);
}
