/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readFile, rm } from "node:fs/promises";
import { EXECUTION_EVENT_TURNS_DIR } from "@noobot/session-protocol/execution-event-index";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import {
  assertArtifactSessionWritable,
  buildSessionArtifactFileMap,
  resolveSessionArtifactMutationLock,
  SESSION_ARTIFACT_FILE_NAMES,
} from "./session-artifact-files.js";
import {
  listExecutionEventTurns,
  readExecutionSegmentState,
  readRegisteredExecutionTurns,
  resolveExecutionTurnDir,
  writeExecutionTurnIndex,
} from "./session-artifact-execution-logs.js";
import { resolveTurnArtifactPath, readRecentSessionTurns } from "./session-artifact-session.js";
import { assertCanonicalSessionManifest } from "./session-artifact-session/turn-journal-store.js";
import {
  assertTurnJournalBoundary,
  isOwnedSessionRepairTempDirectoryName,
  reconcileExecutionSegmentIndex,
} from "@noobot/session-repair";
import { requireBoolean } from "@noobot/shared/value";
import { requireStorageService } from "./storage-service.js";
import { readDirectoryEntriesIfPresent } from "../shared/storage/dir-entries.js";

function diagnostic(code, message, extra = {}) {
  return { code, message, ...extra };
}

function isTurnJournalFile(entry) {
  return entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl"));
}

function isTempFile(entry) {
  return entry.isFile() && (entry.name.endsWith(".tmp") || entry.name.includes(".tmp-"));
}

async function listTurnJournalNames(turnsDir) {
  const entries = await readDirectoryEntriesIfPresent(turnsDir);
  return entries.filter(isTurnJournalFile).map((entry) => entry.name);
}

async function listSummarySnapshotFiles(turnSnapshotsDir) {
  const files = [];
  for (const turnEntry of await readDirectoryEntriesIfPresent(turnSnapshotsDir)) {
    if (!turnEntry.isDirectory()) continue;
    const entries = await readDirectoryEntriesIfPresent(
      path.join(turnSnapshotsDir, turnEntry.name),
    );
    const snapshots = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    files.push(
      ...snapshots.map((entry) =>
        path
          .join(SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir, turnEntry.name, entry.name)
          .replaceAll("\\", "/"),
      ),
    );
  }
  return files;
}

async function listTempFiles(dirs) {
  const targets = [];
  for (const dir of dirs) {
    const entries = await readDirectoryEntriesIfPresent(dir);
    targets.push(...entries.filter(isTempFile).map((entry) => path.join(dir, entry.name)));
  }
  return targets;
}

async function listOwnedRepairTempDirs(sessionDir) {
  const parentDir = path.dirname(sessionDir);
  const baseName = path.basename(sessionDir);
  const entries = await readDirectoryEntriesIfPresent(parentDir);
  return entries
    .filter(
      (entry) => entry.isDirectory() && isOwnedSessionRepairTempDirectoryName(entry.name, baseName),
    )
    .map((entry) => path.join(parentDir, entry.name));
}

async function readExecutionSegmentStates({ storageService, sessionDir }) {
  const turns = [];
  for (const turn of await readRegisteredExecutionTurns({ storageService, sessionDir })) {
    const segments = [];
    for (const segment of turn.index.segments) {
      const actual = await readExecutionSegmentState({ turnDir: turn.turnDir, file: segment.file });
      segments.push({ file: segment.file, bytes: actual.bytes, records: actual.records.length });
    }
    turns.push({ ...turn, segments });
  }
  return turns;
}

export async function inspectSessionArtifacts({ storageService, sessionDir }) {
  requireStorageService(storageService, "inspectSessionArtifacts");
  const files = buildSessionArtifactFileMap(sessionDir);
  const result = {
    sessionDir,
    ok: true,
    issues: [],
    turns: { referenced: 0, orphaned: [] },
    summarySnapshots: { orphaned: [] },
    execution: null,
  };
  const manifest = await storageService.readOptionalJson(files.session);
  if (manifest === null)
    return {
      ...result,
      ok: false,
      issues: [diagnostic("SESSION_MANIFEST_MISSING", "session manifest is missing")],
    };
  try {
    assertCanonicalSessionManifest(manifest, "Session artifact inspect");
  } catch (error) {
    return { ...result, ok: false, issues: [diagnostic(error.code, error.message)] };
  }
  const referenced = new Set();
  for (const item of manifest.turnOrder) {
    const { file } = item;
    try {
      const resolved = resolveTurnArtifactPath(sessionDir, file);
      referenced.add(path.basename(resolved));
      const raw = await readFile(resolved);
      assertTurnJournalBoundary(file, raw.length, item.committedBytes);
      result.turns.referenced += 1;
    } catch (error) {
      result.ok = false;
      result.issues.push(diagnostic(error.code || "TURN_INVALID", error.message, { file }));
    }
  }
  try {
    const names = await listTurnJournalNames(files.turnsDir);
    result.turns.orphaned = names.filter((name) => !referenced.has(name));
  } catch (error) {
    result.ok = false;
    result.issues.push(diagnostic("TURNS_READ_FAILED", error.message));
  }
  const referencedSnapshots = new Set();
  try {
    const turns = await readRecentSessionTurns({
      storageService,
      sessionDir,
      limit: manifest.turnOrder.length,
    });
    for (const snapshot of turns.flatMap((entry) => entry.summarySnapshots)) {
      referencedSnapshots.add(snapshot.file);
    }
  } catch (error) {
    result.ok = false;
    result.issues.push(diagnostic(error.code || "SUMMARY_SNAPSHOT_INVALID", error.message));
  }
  try {
    const snapshotFiles = await listSummarySnapshotFiles(files.turnSnapshotsDir);
    result.summarySnapshots.orphaned = snapshotFiles.filter(
      (file) => !referencedSnapshots.has(file),
    );
  } catch (error) {
    result.ok = false;
    result.issues.push(diagnostic("SUMMARY_SNAPSHOTS_READ_FAILED", error.message));
  }
  try {
    const turns = await readExecutionSegmentStates({ storageService, sessionDir });
    result.execution = {
      turns: turns.length,
      segments: turns.reduce((total, turn) => total + turn.index.segments.length, 0),
    };
    for (const turn of turns) {
      turn.index.segments.forEach((segment, position) => {
        const actual = turn.segments[position];
        if (segment.bytes === actual.bytes && segment.records === actual.records) return;
        result.ok = false;
        result.issues.push(
          diagnostic("EXECUTION_INDEX_MISMATCH", "execution index does not match segment", {
            turn: turn.dialogProcessId,
            file: segment.file,
          }),
        );
      });
    }
  } catch (error) {
    result.ok = false;
    result.issues.push(diagnostic(error.code, error.message));
  }
  return result;
}

export async function cleanupSessionArtifacts({
  storageService,
  sessionDir,
  sessionId,
  dryRun,
  assertSessionWritable,
}) {
  requireStorageService(storageService, "cleanupSessionArtifacts");
  requireBoolean("cleanupSessionArtifacts", "dryRun", dryRun);
  const run = async () => {
    await assertArtifactSessionWritable({
      assertSessionWritable,
      sessionId,
      sessionDir,
      operation: "cleanup_session_artifacts",
    });
    const report = await inspectSessionArtifacts({ storageService, sessionDir });
    const files = buildSessionArtifactFileMap(sessionDir);
    const removed = [];
    const removePath = async (targetPath, options = {}) => {
      removed.push(targetPath);
      if (!dryRun) await rm(targetPath, { recursive: true, force: true, ...options });
    };
    for (const name of report.turns.orphaned)
      await removePath(path.join(files.turnsDir, name), { recursive: false });
    for (const name of report.summarySnapshots.orphaned)
      await removePath(path.join(sessionDir, name), { recursive: false });
    const executionTurnDirs = (await listExecutionEventTurns({ storageService, sessionDir })).map(
      (turn) => resolveExecutionTurnDir(sessionDir, turn.dialogProcessId),
    );
    const tempFiles = await listTempFiles([
      sessionDir,
      files.turnsDir,
      files.executionEventsDir,
      ...executionTurnDirs,
    ]);
    for (const target of tempFiles) await removePath(target, { recursive: false });
    for (const target of await listOwnedRepairTempDirs(sessionDir)) await removePath(target);
    return { ...report, dryRun, removed };
  };
  const lockDir = resolveSessionArtifactMutationLock(sessionDir);
  return dryRun ? run() : sessionMutationCoordinator.run(lockDir, run);
}

export async function repairSessionArtifacts({
  storageService,
  sessionDir,
  sessionId,
  alreadyLocked,
  assertSessionWritable,
}) {
  requireStorageService(storageService, "repairSessionArtifacts");
  requireBoolean("repairSessionArtifacts", "alreadyLocked", alreadyLocked);
  const run = async () => {
    await assertArtifactSessionWritable({
      assertSessionWritable,
      sessionId,
      sessionDir,
      operation: "repair_session_artifacts",
    });
    const before = await inspectSessionArtifacts({ storageService, sessionDir });
    const repaired = [];
    for (const turn of await readExecutionSegmentStates({ storageService, sessionDir })) {
      const reconciled = reconcileExecutionSegmentIndex(turn.index, turn.segments);
      if (!reconciled.repaired.length) continue;
      await writeExecutionTurnIndex({
        storageService,
        turnDir: turn.turnDir,
        index: reconciled.index,
      });
      repaired.push(
        ...reconciled.repaired.map(
          (file) => `${EXECUTION_EVENT_TURNS_DIR}/${turn.dialogProcessId}/${file}`,
        ),
      );
    }
    return {
      before,
      repaired,
      after: await inspectSessionArtifacts({ storageService, sessionDir }),
    };
  };
  if (alreadyLocked) return run();
  const lockDir = resolveSessionArtifactMutationLock(sessionDir);
  return sessionMutationCoordinator.run(lockDir, run);
}
