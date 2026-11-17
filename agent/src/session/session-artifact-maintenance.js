/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { EXECUTION_EVENT_INDEX_ERROR_CODE } from "@noobot/session-protocol/execution-event-index";
import {
  immutableStorageError,
  IMMUTABLE_MAINTENANCE_BUDGET,
  requireImmutableMaintenanceLimit,
  requireImmutableCleanupRequest,
  requireImmutableReaderRecoveryRequest,
} from "@noobot/session-protocol/immutable-storage";
import {
  requireImmutableCompactionRequest,
  requireImmutableCompactionRecords,
  requireImmutableRelocationConflict,
  requireImmutableCompactionResult,
  requireImmutableLocationRetirementRequest,
} from "@noobot/session-protocol/immutable-record-location";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import {
  assertArtifactSessionWritable,
  resolveSessionArtifactMutationLock,
} from "./session-artifact-files.js";
import {
  readExecutionSegmentStates,
  recoverExecutionLogIndexes,
} from "./execution-log-recovery.js";
import { requireBoolean } from "@noobot/shared/value";
import { requireStorageService } from "./storage-service.js";
import {
  auditImmutableSession,
  auditLockedImmutableSession,
} from "./session-artifact-session/immutable-session-audit.js";
import {
  buildImmutableCleanupPlan,
  applyImmutableCleanupPlan,
  discardImmutableCleanupPlan,
} from "./session-artifact-session/immutable-cleanup-plan.js";
import { withImmutableCleanupPlanMutation } from "./session-artifact-session/immutable-cleanup-coordinator.js";
import {
  captureImmutableObjectRepairs,
  restoreImmutableObjects,
} from "./session-artifact-session/immutable-object-repair.js";
import { ImmutableSessionStore } from "./session-artifact-session/immutable-session-store.js";
import { ImmutableLocationRetirement } from "./session-artifact-session/immutable-location-retirement.js";
import { immutableOfflineBackend } from "./session-artifact-session/immutable-storage-backends.js";
import {
  inspectImmutableReaderRetention,
  recoverImmutableReaderRetention,
} from "./session-artifact-session/immutable-reader-retention.js";

async function inspectExecutionArtifacts(storageService, sessionDir, signal) {
  const turns = await readExecutionSegmentStates({ storageService, sessionDir, signal });
  const issues = [];
  for (const turn of turns) {
    if (!turn.registered)
      issues.push({
        code: EXECUTION_EVENT_INDEX_ERROR_CODE.TURN_UNREGISTERED,
        message: "execution turn is not registered in the session index",
        turn: turn.dialogProcessId,
      });
    issues.push(
      ...turn.segments
        .filter((segment) => !segment.indexed)
        .map((segment) => ({
          code: EXECUTION_EVENT_INDEX_ERROR_CODE.SEGMENT_UNINDEXED,
          message: "execution segment is not published in the turn index",
          turn: turn.dialogProcessId,
          file: segment.file,
        })),
    );
    const actualSegments = new Map(turn.segments.map((segment) => [segment.file, segment]));
    if (turn.index === null) continue;
    turn.index.segments.forEach((segment) => {
      const actual = actualSegments.get(segment.file);
      if (segment.bytes !== actual.bytes || segment.records !== actual.records)
        issues.push({
          code: "EXECUTION_INDEX_MISMATCH",
          message: "execution index does not match segment",
          turn: turn.dialogProcessId,
          file: segment.file,
        });
    });
  }
  return {
    issues,
    turns: turns.length,
    segments: turns.reduce((total, turn) => total + turn.segments.length, 0),
  };
}

export async function inspectSessionArtifacts({
  storageService,
  sessionDir,
  sessionId,
  signal,
  retainedObjects,
  maxObjectReads,
}) {
  requireStorageService(storageService, "inspectSessionArtifacts");
  const storage = await auditImmutableSession({
    sessionDir,
    sessionId,
    signal,
    retainedObjects,
    maxObjectReads,
  });
  return inspectAuditedArtifacts({ storageService, sessionDir, signal }, storage);
}

async function inspectLockedSessionArtifacts(options) {
  const storage = await auditLockedImmutableSession(options);
  return inspectAuditedArtifacts(options, storage);
}

async function inspectAuditedArtifacts({ storageService, sessionDir, signal }, storage) {
  const result = {
    sessionDir,
    ok: storage.ok,
    storage,
    issues: [...storage.issues],
    execution: null,
  };
  if (!storage.ok) return result;
  try {
    const execution = await inspectExecutionArtifacts(storageService, sessionDir, signal);
    result.execution = { turns: execution.turns, segments: execution.segments };
    result.issues.push(...execution.issues);
    result.ok = result.ok && execution.issues.length === 0;
  } catch (error) {
    if (signal?.aborted) throw error;
    result.ok = false;
    result.issues.push({ code: error.code ?? "EXECUTION_INDEX_INVALID", message: error.message });
  }
  return result;
}

async function runCleanupMutation(options, operation, run) {
  const { storageService, sessionDir, sessionId, assertSessionWritable, signal } = options;
  requireStorageService(storageService, operation);
  return sessionMutationCoordinator.run(
    resolveSessionArtifactMutationLock(sessionDir),
    async () => {
      await assertArtifactSessionWritable({
        assertSessionWritable,
        sessionId,
        sessionDir,
        operation,
      });
      signal?.throwIfAborted();
      return run();
    },
  );
}

export async function compactSessionArtifacts(options) {
  requireImmutableCompactionRequest(options);
  const records = structuredClone(options.records);
  return runCleanupMutation(options, "compact_session_artifacts", async () => {
    const store = await ImmutableSessionStore.open({
      sessionDir: options.sessionDir,
      sessionId: options.sessionId,
    });

    return store.transact({
      expectedGeneration: options.expectedGeneration,
      operationId: options.operationId,
      input: { kind: "compact-records", records },
      prepare: async ({ snapshot, input }) => {
        requireImmutableCompactionRecords(input.records, snapshot);
        const conflicts = [];
        for (const source of input.records) {
          options.signal?.throwIfAborted();
          try {
            await store.objects.relocate(source);
          } catch (error) {
            if (error.code !== "SESSION_RELOCATION_SOURCE_CHANGED") throw error;
            conflicts.push(requireImmutableRelocationConflict(error.conflict));
          }
        }
        options.signal?.throwIfAborted();
        return {
          changes: [],
          result: requireImmutableCompactionResult(
            { relocatedRecords: input.records.length - conflicts.length, conflicts },
            input.records,
          ),
        };
      },
      projectResult: (outcome) => {
        requireImmutableCompactionResult(outcome.result, records);
        return outcome;
      },
    });
  });
}

export async function retireSessionArtifactLocations(options) {
  requireImmutableLocationRetirementRequest(options);
  const request = { ...options, records: structuredClone(options.records) };
  return runCleanupMutation(request, "retire_session_artifact_locations", async () => {
    const store = await ImmutableSessionStore.open({
      sessionDir: request.sessionDir,
      sessionId: request.sessionId,
    });
    return new ImmutableLocationRetirement(store, request).run();
  });
}

export async function discardSessionArtifactLocationRetirement(options) {
  requireImmutableLocationRetirementRequest(options);
  const request = { ...options, records: structuredClone(options.records) };
  return runCleanupMutation(request, "discard_session_artifact_location_retirement", async () => {
    const store = await ImmutableSessionStore.open({
      sessionDir: request.sessionDir,
      sessionId: request.sessionId,
    });
    return new ImmutableLocationRetirement(store, request).discard();
  });
}

export async function prepareSessionArtifactCleanup(options) {
  requireImmutableCleanupRequest("prepare", options);
  const run = () =>
    buildImmutableCleanupPlan({
      sessionDir: options.sessionDir,
      sessionId: options.sessionId,
      dryRun: options.dryRun,
      signal: options.signal,
      planId: options.planId,
      maxMarkingPages: options.maxMarkingPages,
      maxFilterEntries: options.maxFilterEntries,
      publish: (run) => runCleanupMutation(options, "publish_session_artifact_cleanup", run),
    });
  await runCleanupMutation(
    options,
    options.planId === undefined
      ? "prepare_session_artifact_cleanup"
      : "resume_session_artifact_cleanup",
    async () => {},
  );
  return run();
}

export async function cleanupSessionArtifacts(options) {
  requireImmutableCleanupRequest("apply", options);
  const {
    maxRemovals = IMMUTABLE_MAINTENANCE_BUDGET.maxRemovals,
    maxCandidates = IMMUTABLE_MAINTENANCE_BUDGET.maxCandidates,
  } = options;
  requireImmutableMaintenanceLimit("maxRemovals", maxRemovals);
  requireImmutableMaintenanceLimit("maxCandidates", maxCandidates);
  return withImmutableCleanupPlanMutation(options.sessionDir, options.planId, () =>
    runCleanupMutation(options, "cleanup_session_artifacts", () =>
      applyImmutableCleanupPlan({ ...options, maxRemovals, maxCandidates }),
    ),
  );
}

export async function discardSessionArtifactCleanup(options) {
  requireImmutableCleanupRequest("discard", options);
  return withImmutableCleanupPlanMutation(options.sessionDir, options.planId, () =>
    runCleanupMutation(options, "discard_session_artifact_cleanup", () =>
      discardImmutableCleanupPlan(options),
    ),
  );
}

function openReaderRecoveryStore({ sessionDir, sessionId, format }) {
  return ImmutableSessionStore.open({
    sessionDir,
    sessionId,
    objectStore: immutableOfflineBackend(format),
  });
}

export async function inspectSessionArtifactReader(options) {
  requireImmutableReaderRecoveryRequest("inspect", options);
  requireStorageService(options.storageService, "inspectSessionArtifactReader");
  return sessionMutationCoordinator.run(
    resolveSessionArtifactMutationLock(options.sessionDir),
    async () => {
      options.signal?.throwIfAborted();
      const store = await openReaderRecoveryStore(options);
      return inspectImmutableReaderRetention(store, options.readerId);
    },
  );
}

export async function recoverSessionArtifactReader(options) {
  requireImmutableReaderRecoveryRequest("recover", options);
  return runCleanupMutation(options, "recover_session_artifact_reader", async () => {
    await options.assertReadersStopped({
      sessionDir: options.sessionDir,
      sessionId: options.sessionId,
      readerId: options.readerId,
    });
    options.signal?.throwIfAborted();
    const store = await openReaderRecoveryStore(options);
    return recoverImmutableReaderRetention(store, options);
  });
}

export async function repairSessionArtifacts({
  storageService,
  sessionDir,
  sessionId,
  objectStore,
  alreadyLocked,
  assertSessionWritable,
  objectReplacements = [],
  signal,
}) {
  requireStorageService(storageService, "repairSessionArtifacts");
  requireBoolean("repairSessionArtifacts", "alreadyLocked", alreadyLocked);
  const replacements = captureImmutableObjectRepairs(objectReplacements);
  const run = async () => {
    await assertArtifactSessionWritable({
      assertSessionWritable,
      sessionId,
      sessionDir,
      operation: "repair_session_artifacts",
    });
    const before = await inspectLockedSessionArtifacts({
      storageService,
      sessionDir,
      sessionId,
      signal,
      objectStore,
    });
    if (!replacements.size && !before.storage.ok)
      throw Object.assign(
        immutableStorageError("Object repair requires original committed bytes"),
        {
          report: before.storage,
        },
      );
    const repaired = replacements.size
      ? await restoreImmutableObjects({ sessionDir, sessionId, replacements, signal, objectStore })
      : [];
    const execution = await recoverExecutionLogIndexes({ storageService, sessionDir, signal });
    repaired.push(...execution.repaired);
    return {
      before,
      repaired,
      after: await inspectLockedSessionArtifacts({
        storageService,
        sessionDir,
        sessionId,
        signal,
        objectStore,
      }),
    };
  };
  return alreadyLocked
    ? run()
    : sessionMutationCoordinator.run(resolveSessionArtifactMutationLock(sessionDir), run);
}
