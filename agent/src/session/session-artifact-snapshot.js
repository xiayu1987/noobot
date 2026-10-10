/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { runBestEffort } from "@noobot/shared/best-effort";
import { isSessionDeletedError } from "@noobot/session-protocol";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { buildSessionDisplaySummary } from "./session-summary-builders.js";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import {
  buildSessionArtifactFileMap,
  readJsonArtifactFile,
  requireSessionWritableGuard,
  writeJsonArtifactFile,
} from "./session-artifact-files.js";
import { copyExecutionEvents, readExecutionLogs } from "./session-artifact-execution-logs.js";
import {
  readSessionArtifactForRepair,
  writeSessionArtifact,
  writeTaskArtifact,
} from "./session-artifact-session.js";
import { normalizeSessionDocumentForCurrentProtocol } from "./session-document-normalization.js";

export const SNAPSHOT_MANIFEST_FILE = "snapshot-manifest.json";
export const SNAPSHOT_COMMITTED_FILE = "COMMITTED";
export const SNAPSHOT_MANIFEST_SCHEMA_VERSION = 1;

export async function writeSessionArtifactSnapshotCommit({ outputDir, sessionId, committedAt }) {
  const manifest = { schemaVersion: SNAPSHOT_MANIFEST_SCHEMA_VERSION, sessionId, committedAt };
  await writeJsonArtifactFile(path.join(outputDir, SNAPSHOT_MANIFEST_FILE), manifest);
  await writeFile(path.join(outputDir, SNAPSHOT_COMMITTED_FILE), `${committedAt}\n`, "utf8");
  return manifest;
}

export async function persistSessionArtifactSnapshot({
  outputDir = "",
  sessionPayload = {},
  taskPayload = {},
  executionEventsSourceDir = "",
  metadata = null,
  now = () => new Date().toISOString(),
  mutationCoordinator = sessionMutationCoordinator,
  mutationLockDir = "",
  assertSessionWritable,
} = {}) {
  requireSessionWritableGuard(assertSessionWritable);
  const normalizedSessionPayload =
    sessionPayload && typeof sessionPayload === "object" ? sessionPayload : {};
  const sessionId = String(normalizedSessionPayload?.sessionId || "").trim();
  const assertWritable = () => assertSessionWritable({ sessionId, outputDir });
  const run = async () => {
    const parentDir = path.dirname(outputDir);
    const stagingDir = `${outputDir}.staging-${process.pid}-${Date.now()}`;
    await assertWritable();
    await mkdir(parentDir, { recursive: true });
    await mkdir(stagingDir, { recursive: true });
    const files = buildSessionArtifactFileMap(stagingDir);
    const sourceSessionDir = String(executionEventsSourceDir || "").trim();
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
        sourceSessionDir
          ? copyExecutionEvents(sourceSessionDir, stagingDir)
          : rm(files.executionEventsDir, { recursive: true, force: true }),
        writeJsonArtifactFile(files.meta, metadata && typeof metadata === "object" ? metadata : {}),
      ]);
      await assertWritable();
      await writeSessionArtifactSnapshotCommit({
        outputDir: stagingDir,
        sessionId: String(sessionArtifact?.session?.sessionId || ""),
        committedAt: now(),
      });
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
            if (!isSessionDeletedError(restoreError)) {
              restoreError.cause = restoreError.cause || error;
              throw restoreError;
            }
          }
        }
        throw error;
      }
    } catch (error) {
      await runBestEffort(() => rm(stagingDir, { recursive: true, force: true }), {
        operationName: "sessionArtifactSnapshot.removeStagingDirectory",
        context: { stagingDir },
      });
      if (hadPrevious && backupDir) {
        await runBestEffort(() => rm(backupDir, { recursive: true, force: true }), {
          operationName: "sessionArtifactSnapshot.removeBackupDirectory",
          context: { backupDir },
        });
      }
      throw error;
    }
    const publishedFiles = buildSessionArtifactFileMap(outputDir);
    return {
      outputDir,
      files: publishedFiles,
      session: sessionArtifact?.session || null,
      sessionSummary: sessionArtifact?.sessionSummary || null,
      aggregateVersion: Number(
        sessionArtifact?.session?.aggregateVersion ||
          sessionArtifact?.sessionSummary?.aggregateVersion ||
          0,
      ),
    };
  };
  const lockDir = String(mutationLockDir || "").trim();
  return lockDir && mutationCoordinator?.run ? mutationCoordinator.run(lockDir, run) : run();
}

export async function readSessionArtifactSnapshot({
  outputDir = "",
  includeExecutionLogs = true,
} = {}) {
  const committedPath = path.join(outputDir, SNAPSHOT_COMMITTED_FILE);
  const snapshotManifestPath = path.join(outputDir, SNAPSHOT_MANIFEST_FILE);
  const snapshotManifest = await readJsonArtifactFile(snapshotManifestPath, null);
  let committed = false;
  try {
    await readFile(committedPath, "utf8");
    committed = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!snapshotManifest) {
    const error = new Error("snapshot manifest is missing");
    error.code = "SNAPSHOT_MANIFEST_MISSING";
    throw error;
  }
  if (!committed) {
    const error = new Error("snapshot is not committed");
    error.code = "SNAPSHOT_NOT_COMMITTED";
    throw error;
  }
  const files = buildSessionArtifactFileMap(outputDir);
  const [sessionRaw, task, executionLogs, meta] = await Promise.all([
    readSessionArtifactForRepair({ sessionDir: outputDir, fallback: null }),
    readJsonArtifactFile(files.task, null),
    includeExecutionLogs ? readExecutionLogs(outputDir) : Promise.resolve([]),
    readJsonArtifactFile(files.meta, null),
  ]);
  const session = sessionRaw
    ? normalizeSessionDocumentForCurrentProtocol(sessionRaw, {
        sessionId: String(sessionRaw?.sessionId || "").trim(),
      }).document
    : null;
  const sessionSummary = session ? buildSessionDisplaySummary(session) : null;
  if (String(snapshotManifest.sessionId || "") !== String(session?.sessionId || "")) {
    const error = new Error("snapshot manifest session does not match session artifact");
    error.code = "SNAPSHOT_MANIFEST_MISMATCH";
    throw error;
  }
  return {
    files,
    session,
    sessionSummary,
    task,
    executionLogs,
    meta,
  };
}
