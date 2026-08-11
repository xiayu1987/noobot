/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { readFile, readdir, rm } from "node:fs/promises";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import {
  assertArtifactSessionWritable,
  buildSessionArtifactFileMap,
  readJsonArtifactFile,
  resolveArtifactMutationLockDir,
  SESSION_ARTIFACT_FILE_NAMES,
} from "./session-artifact-files.js";
import { writeArtifactIndex } from "./session-artifact-execution-logs.js";
import { resolveTurnArtifactPath, readRecentSessionTurns } from "./session-artifact-session.js";
import { reconcileExecutionSegmentIndex } from "@noobot/session-repair";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

function diagnostic(code, message, extra = {}) {
  return { code, message, ...extra };
}

export async function inspectSessionArtifacts({ sessionDir = "" } = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const result = {
    sessionDir,
    ok: true,
    issues: [],
    turns: { referenced: 0, orphaned: [] },
    summarySnapshots: { orphaned: [] },
    execution: null,
  };
  const manifest = await readJsonArtifactFile(files.session, null);
  if (!manifest)
    return {
      ...result,
      ok: false,
      issues: [diagnostic("SESSION_MANIFEST_MISSING", "session manifest is missing")],
    };
  const referenced = new Set();
  for (const item of Array.isArray(manifest.turnOrder) ? manifest.turnOrder : []) {
    const file = typeof item === "string" ? item : item?.file;
    try {
      const resolved = resolveTurnArtifactPath(sessionDir, file);
      referenced.add(path.basename(resolved));
      if (Number(manifest.schemaVersion) === TURN_THRESHOLDS.session.turnJournalSchemaVersion) {
        const raw = await readFile(resolved);
        if (raw.length < Number(item?.committedBytes || 0))
          throw Object.assign(
            new Error(`turn journal is shorter than committed watermark: ${file}`),
            { code: "TURN_JOURNAL_TRUNCATED" },
          );
      } else await readJsonArtifactFile(resolved);
      result.turns.referenced += 1;
    } catch (error) {
      result.ok = false;
      result.issues.push(diagnostic(error.code || "TURN_INVALID", error.message, { file }));
    }
  }
  try {
    for (const entry of await readdir(files.turnsDir, { withFileTypes: true }))
      if (
        entry.isFile() &&
        (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")) &&
        !referenced.has(entry.name)
      )
        result.turns.orphaned.push(entry.name);
  } catch (error) {
    if (error.code !== "ENOENT") {
      result.ok = false;
      result.issues.push(diagnostic("TURNS_READ_FAILED", error.message));
    }
  }
  const referencedSnapshots = new Set();
  try {
    const turns = await readRecentSessionTurns({
      sessionDir,
      limit: manifest.turnOrder?.length || 0,
    });
    for (const snapshot of turns.flatMap((entry) => entry.summarySnapshots || [])) {
      referencedSnapshots.add(String(snapshot.file || "").replaceAll("\\", "/"));
    }
  } catch (error) {
    result.ok = false;
    result.issues.push(diagnostic(error.code || "SUMMARY_SNAPSHOT_INVALID", error.message));
  }
  try {
    for (const turnEntry of await readdir(files.turnSnapshotsDir, { withFileTypes: true })) {
      if (!turnEntry.isDirectory()) continue;
      for (const entry of await readdir(path.join(files.turnSnapshotsDir, turnEntry.name), {
        withFileTypes: true,
      })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const relative = path
          .join(SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir, turnEntry.name, entry.name)
          .replaceAll("\\", "/");
        if (!referencedSnapshots.has(relative)) result.summarySnapshots.orphaned.push(relative);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      result.ok = false;
      result.issues.push(diagnostic("SUMMARY_SNAPSHOTS_READ_FAILED", error.message));
    }
  }
  try {
    const index = await readJsonArtifactFile(
      path.join(files.executionEventsDir, "index.json"),
      null,
    );
    result.execution = { segments: index?.segments?.length || 0, index };
    if (index?.segments)
      for (const segment of index.segments) {
        const raw = await readFile(path.join(files.executionEventsDir, segment.file), "utf8");
        const records = raw ? raw.split("\n").filter(Boolean) : [];
        const bytes = Buffer.byteLength(raw, "utf8");
        if (bytes !== Number(segment.bytes) || records.length !== Number(segment.records)) {
          result.ok = false;
          result.issues.push(
            diagnostic("EXECUTION_INDEX_MISMATCH", "execution index does not match segment", {
              file: segment.file,
            }),
          );
        }
      }
  } catch (error) {
    if (error.code !== "ENOENT") {
      result.ok = false;
      result.issues.push(diagnostic(error.code || "EXECUTION_INSPECT_FAILED", error.message));
    }
  }
  return result;
}

export async function cleanupSessionArtifacts({
  sessionDir = "",
  sessionId = "",
  dryRun = true,
  mutationCoordinator = sessionMutationCoordinator,
  mutationLockDir = "",
  assertSessionWritable = null,
  allowDeletedCleanup = false,
} = {}) {
  const run = async () => {
    if (!allowDeletedCleanup) {
      await assertArtifactSessionWritable({
        assertSessionWritable,
        sessionId,
        sessionDir,
        operation: "cleanup_session_artifacts",
      });
    }
    const report = await inspectSessionArtifacts({ sessionDir });
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
    for (const dir of [sessionDir, files.turnsDir, files.executionEventsDir]) {
      try {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.isFile() && (entry.name.endsWith(".tmp") || entry.name.includes(".tmp-")))
            await removePath(path.join(dir, entry.name), { recursive: false });
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    const parentDir = path.dirname(sessionDir);
    const baseName = path.basename(sessionDir);
    try {
      for (const entry of await readdir(parentDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (
          entry.name.startsWith(`${baseName}.staging-`) ||
          entry.name.startsWith(`${baseName}.backup-`)
        )
          await removePath(path.join(parentDir, entry.name));
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return { ...report, dryRun, removed };
  };
  const lockDir = resolveArtifactMutationLockDir(sessionDir, mutationLockDir);
  return dryRun || !mutationCoordinator?.run ? run() : mutationCoordinator.run(lockDir, run);
}

export async function repairSessionArtifacts({
  sessionDir = "",
  sessionId = "",
  mutationCoordinator = sessionMutationCoordinator,
  mutationLockDir = "",
  assertSessionWritable = null,
} = {}) {
  const run = async () => {
    await assertArtifactSessionWritable({
      assertSessionWritable,
      sessionId,
      sessionDir,
      operation: "repair_session_artifacts",
    });
    const before = await inspectSessionArtifacts({ sessionDir });
    const files = buildSessionArtifactFileMap(sessionDir);
    const index = await readJsonArtifactFile(
      path.join(files.executionEventsDir, "index.json"),
      null,
    );
    let repaired = [];
    if (index?.segments) {
      const segmentMetadata = [];
      for (const segment of index.segments) {
        const segmentPath = path.join(files.executionEventsDir, segment.file);
        const raw = await readFile(segmentPath, "utf8");
        if (raw && !raw.endsWith("\n")) {
          const error = new Error(`execution segment has a torn final record: ${segment.file}`);
          error.code = "EXECUTION_EVENT_SEGMENT_TORN_WRITE";
          throw error;
        }
        const records = raw ? raw.split("\n").filter(Boolean) : [];
        for (const record of records) JSON.parse(record);
        const bytes = Buffer.byteLength(raw, "utf8");
        segmentMetadata.push({ file: segment.file, bytes, records: records.length });
      }
      const reconciled = reconcileExecutionSegmentIndex(index, segmentMetadata);
      repaired = reconciled.repaired;
      Object.assign(index, reconciled.index);
      if (repaired.length) await writeArtifactIndex(files.executionEventsDir, index);
    }
    return { before, repaired, after: await inspectSessionArtifacts({ sessionDir }) };
  };
  const lockDir = resolveArtifactMutationLockDir(sessionDir, mutationLockDir);
  return mutationCoordinator?.run ? mutationCoordinator.run(lockDir, run) : run();
}
