/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../utils/path-resolver.js";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isSessionDisplaySummaryPayload } from "./session-summary-builders.js";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import { buildSessionArtifactFileMap, readJsonArtifactFile, writeJsonArtifactFile } from "./session-artifact-files.js";
import { appendRollingJsonlArtifactLog, readJsonlArtifactFile } from "./session-artifact-execution-logs.js";
import { readSessionArtifact, writeExecutionArtifact, writeSessionArtifact, writeTaskArtifact } from "./session-artifact-session.js";

function createSessionDeletedSnapshotError(sessionId = "") {
  const error = new Error(`session has been deleted: ${String(sessionId || "").trim()}`);
  error.statusCode = 410;
  error.errorCode = "SESSION_DELETED";
  error.code = "SESSION_DELETED";
  error.sessionId = String(sessionId || "").trim();
  return error;
}

export async function persistSessionArtifactSnapshot({
  outputDir = "",
  sessionPayload = {},
  taskPayload = {},
  executionPayload = {},
  metadata = null,
  now = () => new Date().toISOString(),
  mutationCoordinator = sessionMutationCoordinator,
  mutationLockDir = "",
  assertSessionWritable = null,
} = {}) {
  const normalizedSessionPayload = sessionPayload && typeof sessionPayload === "object" ? sessionPayload : {};
  const sessionId = String(normalizedSessionPayload?.sessionId || "").trim();
  const assertWritable = async () => {
    if (typeof assertSessionWritable !== "function") return true;
    const result = await assertSessionWritable({ sessionId, outputDir });
    if (result === false) throw createSessionDeletedSnapshotError(sessionId);
    return true;
  };
  const run = async () => {
    const parentDir = path.dirname(outputDir);
    const stagingDir = `${outputDir}.staging-${process.pid}-${Date.now()}`;
    await assertWritable();
    await mkdir(parentDir, { recursive: true });
    await mkdir(stagingDir, { recursive: true });
    const files = buildSessionArtifactFileMap(stagingDir);
    const normalizedExecutionPayload =
      executionPayload && typeof executionPayload === "object" ? executionPayload : {};
    const executionLogs = Array.isArray(normalizedExecutionPayload?.logs)
      ? normalizedExecutionPayload.logs
      : [];
    let sessionArtifact = null;
    let backupDir = "";
    let hadPrevious = false;
    try {
      [sessionArtifact] = await Promise.all([
        writeSessionArtifact({
          sessionDir: stagingDir,
          sessionPayload: normalizedSessionPayload,
          now,
        }),
        writeTaskArtifact({
          sessionDir: stagingDir,
          taskPayload: taskPayload && typeof taskPayload === "object" ? taskPayload : {},
        }),
        writeExecutionArtifact({
          sessionDir: stagingDir,
          executionPayload: normalizedExecutionPayload,
        }),
        (async () => {
          await rm(files.executionEventsDir, { recursive: true, force: true });
          for (const log of executionLogs) {
            await appendRollingJsonlArtifactLog({ sessionDir: stagingDir, log });
          }
        })(),
        writeJsonArtifactFile(files.meta, metadata && typeof metadata === "object" ? metadata : {}),
      ]);
      await assertWritable();
      const manifest = {
        schemaVersion: 1,
        sessionId: String(sessionArtifact?.session?.sessionId || ""),
        committedAt: now(),
      };
      await writeJsonArtifactFile(path.join(stagingDir, "snapshot-manifest.json"), manifest);
      await writeFile(path.join(stagingDir, "COMMITTED"), `${manifest.committedAt}\n`, "utf8");
      backupDir = `${outputDir}.backup-${process.pid}-${Date.now()}`;
      await assertWritable();
      try {
        await rename(outputDir, backupDir);
        hadPrevious = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      try {
        await assertWritable();
        await rename(stagingDir, outputDir);
        if (hadPrevious) await rm(backupDir, { recursive: true, force: true });
      } catch (error) {
        if (hadPrevious) {
          try {
            await assertWritable();
            await rename(backupDir, outputDir);
          } catch (restoreError) {
            if (restoreError?.code !== "SESSION_DELETED") {
              restoreError.cause = restoreError.cause || error;
              throw restoreError;
            }
          }
        }
        throw error;
      }
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      if (hadPrevious && backupDir) await rm(backupDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const publishedFiles = buildSessionArtifactFileMap(outputDir);
    return {
      outputDir,
      files: publishedFiles,
      session: sessionArtifact?.session || null,
      sessionSummary: sessionArtifact?.sessionSummary || null,
      version: Number(sessionArtifact?.session?.version || sessionArtifact?.sessionSummary?.version || 0),
    };
  };
  const lockDir = String(mutationLockDir || "").trim();
  return lockDir && mutationCoordinator?.run ? mutationCoordinator.run(lockDir, run) : run();
}

export async function readSessionArtifactSnapshot({
  outputDir = "",
  allowLegacy = true,
  includeExecutionLogs = true,
  executionLogOptions = {},
} = {}) {
  const committedPath = path.join(outputDir, "COMMITTED");
  const snapshotManifestPath = path.join(outputDir, "snapshot-manifest.json");
  const snapshotManifest = await readJsonArtifactFile(snapshotManifestPath, null);
  let committed = false;
  try { await readFile(committedPath, "utf8"); committed = true; }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (snapshotManifest && !committed) {
    const error = new Error("snapshot is not committed");
    error.code = "SNAPSHOT_NOT_COMMITTED";
    throw error;
  }
  if (!snapshotManifest && !allowLegacy) {
    const error = new Error("snapshot manifest is missing");
    error.code = "SNAPSHOT_MANIFEST_MISSING";
    throw error;
  }
  const files = buildSessionArtifactFileMap(outputDir);
  const [session, sessionSummaryRaw, task, execution, executionLogs, meta] = await Promise.all([
    readSessionArtifact({ sessionDir: outputDir, fallback: null }),
    readJsonArtifactFile(files.sessionSummary, null),
    readJsonArtifactFile(files.task, null),
    readJsonArtifactFile(files.execution, null),
    includeExecutionLogs ? readJsonlArtifactFile(files.executionEvents, executionLogOptions) : Promise.resolve([]),
    readJsonArtifactFile(files.meta, null),
  ]);
  const sessionSummary = isSessionDisplaySummaryPayload(
    sessionSummaryRaw,
    String(session?.sessionId || "").trim(),
  )
    ? sessionSummaryRaw
    : null;
  if (snapshotManifest && String(snapshotManifest.sessionId || "") !== String(session?.sessionId || "")) {
    const error = new Error("snapshot manifest session does not match session artifact");
    error.code = "SNAPSHOT_MANIFEST_MISMATCH";
    throw error;
  }
  return {
    files,
    session,
    sessionSummary,
    task,
    execution,
    executionLogs,
    meta,
  };
}
