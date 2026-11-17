/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readdir, rm } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { forgetVerifiedSnapshot, getTurnMaterializer } from "./turn-materializer.js";
import { readFileIdentity } from "./verified-snapshot-cache.js";
import { recordStorageWork } from "./storage-transaction.js";
import { resolveTurnJournalPath } from "./turn-journal-store.js";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";

async function readDirectory(directory) {
  recordStorageWork("pruneDirectoryScans");
  return readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

function referencedSnapshots(turnOrder) {
  const files = new Set();
  for (const turn of turnOrder) {
    for (const index of turn.summarySnapshots) {
      recordStorageWork("pruneSnapshotVisits");
      files.add(index.file);
    }
  }
  return files;
}

async function removeSnapshot(sessionDir, file) {
  await rm(path.join(sessionDir, file), { force: true });
  forgetVerifiedSnapshot(sessionDir, file);
}

export async function beginArtifactPruning(files) {
  const materializer = getTurnMaterializer();
  const sessionDir = path.dirname(files.session);
  const identity = await readFileIdentity(files.session).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const reconciled = identity && materializer.isSessionReconciled(sessionDir, identity.key);
  materializer.forgetSessionReconciliation(sessionDir);
  return !reconciled;
}

async function scanTurnSnapshots(sessionDir, directory, turnName, snapshots) {
  for (const entry of await readDirectory(directory)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path
      .join(SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir, turnName, entry.name)
      .replaceAll("\\", "/");
    if (!snapshots.has(file)) await removeSnapshot(sessionDir, file);
  }
}

async function scanOrphans(files, turnOrder) {
  const sessionDir = path.dirname(files.session);
  const journals = new Set(turnOrder.map((turn) => path.basename(turn.file)));
  for (const entry of await readDirectory(files.turnsDir)) {
    if (entry.isFile() && /\.jsonl?$/.test(entry.name) && !journals.has(entry.name))
      await rm(path.join(files.turnsDir, entry.name), { force: true });
  }
  const snapshots = referencedSnapshots(turnOrder);
  for (const turn of await readDirectory(files.turnSnapshotsDir)) {
    if (!turn.isDirectory()) continue;
    await scanTurnSnapshots(
      sessionDir,
      path.join(files.turnSnapshotsDir, turn.name),
      turn.name,
      snapshots,
    );
  }
}

function collectLostSnapshots(turn, next, candidates) {
  if (next?.summarySnapshots === turn.summarySnapshots) return;
  const retained = new Set(next?.summarySnapshots.map((index) => index.file));
  for (const index of turn.summarySnapshots) {
    recordStorageWork("pruneSnapshotVisits");
    if (!retained.has(index.file)) candidates.push(index.file);
  }
}

async function pruneLostReferences(sessionDir, previousManifest, turnOrder) {
  const journals = new Set(turnOrder.map((turn) => turn.file));
  const nextById = new Map(turnOrder.map((turn) => [turn.turnId, turn]));
  const candidates = [];
  for (const turn of previousManifest.turnOrder) {
    if (!journals.has(turn.file))
      await rm(resolveTurnJournalPath(sessionDir, turn.file), { force: true });
    collectLostSnapshots(turn, nextById.get(turn.turnId), candidates);
  }
  if (!candidates.length) return;
  const snapshots = referencedSnapshots(turnOrder);
  for (const file of candidates) {
    if (!snapshots.has(file)) await removeSnapshot(sessionDir, file);
  }
}

export async function pruneSessionArtifacts({ files, previousManifest, turnOrder, fullScan }) {
  const sessionDir = path.dirname(files.session);
  if (fullScan) await scanOrphans(files, turnOrder);
  else await pruneLostReferences(sessionDir, previousManifest, turnOrder);
  const identity = await readFileIdentity(files.session);
  getTurnMaterializer().rememberSessionReconciliation(sessionDir, identity.key);
}
