/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { EXECUTION_REPORT_VERSION } from "@noobot/session-protocol/execution-report";
import {
  SESSION_TREE_UNRECOVERABLE,
  isLegacySessionTree,
  mapLegacySessionTree,
  rebuildSessionTree,
} from "@noobot/session-repair";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { sessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import {
  SESSION_ARTIFACT_FILE_NAMES,
  resolveSessionArtifactMutationLock,
} from "../session/session-artifact-files.js";
import {
  EXECUTION_EVENT_INDEX_FILE,
  EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
} from "../session/session-artifact-execution-logs.js";

const SKIPPED_RUNTIME_DIRECTORIES = new Set([
  WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR,
  WORKSPACE_LAYOUT.MEMORY_REPAIR_BACKUPS_DIR,
  WORKSPACE_LAYOUT.BROWSER_PROFILES_DIR,
  WORKSPACE_LAYOUT.OPS_WORKDIR,
  WORKSPACE_LAYOUT.PLUGIN_ASSETS_DIR,
]);

async function readJsonDocument(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { exists: false };
    throw error;
  }
  try {
    return { exists: true, document: JSON.parse(raw) };
  } catch {
    return { exists: true, document: null };
  }
}

async function listDirectories(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory(),
    );
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

function createRetirement(base, backupBase) {
  return async function retire(relativePath) {
    const target = path.join(backupBase, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(path.join(base, relativePath), target);
    return target;
  };
}

async function readSessionDocuments(sessionRoot) {
  const documents = [];
  for (const entry of await listDirectories(sessionRoot)) {
    const session = await readJsonDocument(
      path.join(sessionRoot, entry.name, SESSION_ARTIFACT_FILE_NAMES.session),
    );
    if (!session.exists) continue;
    documents.push({ directoryName: entry.name, document: session.document });
  }
  return documents;
}

async function resolveSessionTreeUpgrade({ base, document }) {
  if (document && !isLegacySessionTree(document)) return null;
  if (document) return { action: "mapped", tree: mapLegacySessionTree(document) };
  try {
    const sessionRoot = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR);
    return { action: "rebuilt", tree: rebuildSessionTree(await readSessionDocuments(sessionRoot)) };
  } catch (error) {
    if (error?.code !== SESSION_TREE_UNRECOVERABLE) throw error;
    return { action: "retired", reason: error.message };
  }
}

async function upgradeSessionTree({ base, retire }) {
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const current = await readJsonDocument(treeFile);
  if (!current.exists) return null;
  const upgrade = await resolveSessionTreeUpgrade({ base, document: current.document });
  if (!upgrade) return null;
  const backupPath = await retire(WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const report = { path: WORKSPACE_LAYOUT.SESSION_TREE_FILE, action: upgrade.action, backupPath };
  if (upgrade.action === "retired") return { ...report, reason: upgrade.reason };
  await writeFileAtomic({
    filePath: treeFile,
    content: `${JSON.stringify(upgrade.tree, null, 2)}\n`,
    writeFile,
    rename,
    remove: rm,
  });
  return { ...report, nodes: Object.keys(upgrade.tree.nodes).length };
}

async function isRetiredExecutionEvents(sessionDir) {
  const index = await readJsonDocument(
    path.join(
      sessionDir,
      SESSION_ARTIFACT_FILE_NAMES.executionEventsDir,
      EXECUTION_EVENT_INDEX_FILE,
    ),
  );
  return index.exists && index.document?.schemaVersion !== EXECUTION_EVENT_INDEX_SCHEMA_VERSION;
}

async function listRetiredReports(sessionDir) {
  const reportsDir = path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.executionReportsDir);
  let names;
  try {
    names = await readdir(reportsDir);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
  const retired = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const report = await readJsonDocument(path.join(reportsDir, name));
    if (report.document?.version !== EXECUTION_REPORT_VERSION) {
      retired.push(path.join(SESSION_ARTIFACT_FILE_NAMES.executionReportsDir, name));
    }
  }
  return retired;
}

async function retireSessionArtifacts({ base, sessionDir, retire }) {
  const relativeDir = path.relative(base, sessionDir);
  return sessionMutationCoordinator.run(
    resolveSessionArtifactMutationLock(sessionDir),
    async () => {
      const targets = await listRetiredReports(sessionDir);
      if (await isRetiredExecutionEvents(sessionDir)) {
        targets.unshift(SESSION_ARTIFACT_FILE_NAMES.executionEventsDir);
      }
      const retired = [];
      for (const target of targets) {
        const relativePath = path.join(relativeDir, target);
        retired.push({ path: relativePath, backupPath: await retire(relativePath) });
      }
      return retired;
    },
  );
}

const SESSION_ARTIFACT_DIRECTORIES = new Set(Object.values(SESSION_ARTIFACT_FILE_NAMES));
const MUTATION_LOCK_SUFFIX = ".mutation-lock";

async function* walkSessionDirectories(base, directory) {
  const entries = await listDirectories(directory);
  const names = new Set(entries.map((entry) => entry.name));
  if (
    names.has(SESSION_ARTIFACT_FILE_NAMES.executionEventsDir) ||
    names.has(SESSION_ARTIFACT_FILE_NAMES.executionReportsDir)
  ) {
    yield directory;
  }
  for (const entry of entries) {
    if (SESSION_ARTIFACT_DIRECTORIES.has(entry.name)) continue;
    if (entry.name.endsWith(MUTATION_LOCK_SUFFIX)) continue;
    const child = path.join(directory, entry.name);
    if (SKIPPED_RUNTIME_DIRECTORIES.has(path.relative(base, child))) continue;
    yield* walkSessionDirectories(base, child);
  }
}

export async function upgradeSessionStorage({ base, backupBase }) {
  const retire = createRetirement(base, backupBase);
  const sessionTree = await upgradeSessionTree({ base, retire });
  const retired = [];
  const runtimeRoot = path.join(base, WORKSPACE_LAYOUT.RUNTIME_DIR);
  for await (const sessionDir of walkSessionDirectories(base, runtimeRoot)) {
    retired.push(...(await retireSessionArtifacts({ base, sessionDir, retire })));
  }
  return { sessionTree, retired };
}
