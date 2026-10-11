/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { EXECUTION_REPORT_VERSION } from "@noobot/session-protocol/execution-report";
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

export function mapLegacySessionTree(tree) {
  const nodes = tree?.nodes && typeof tree.nodes === "object" ? tree.nodes : {};
  return {
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([sessionId, node]) => [
        sessionId,
        {
          sessionId,
          parentSessionId: String(node?.parentSessionId || "").trim(),
          createdAt: node?.createdAt,
          updatedAt: node?.updatedAt,
        },
      ]),
    ),
    updatedAt: tree?.updatedAt,
  };
}

function isLegacySessionTree(tree) {
  const nodes = tree?.nodes && typeof tree.nodes === "object" ? Object.values(tree.nodes) : [];
  return Boolean(tree) && ("roots" in tree || nodes.some((node) => node && "children" in node));
}

async function upgradeSessionTree({ base, backupBase }) {
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const current = await readJsonDocument(treeFile);
  if (!current.exists || !isLegacySessionTree(current.document)) return null;
  const backupPath = path.join(backupBase, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, `${JSON.stringify(current.document, null, 2)}\n`, { flag: "wx" });
  const next = mapLegacySessionTree(current.document);
  await writeFileAtomic({
    filePath: treeFile,
    content: `${JSON.stringify(next, null, 2)}\n`,
    writeFile,
    rename,
    remove: rm,
  });
  return {
    path: WORKSPACE_LAYOUT.SESSION_TREE_FILE,
    nodes: Object.keys(next.nodes).length,
    backupPath,
  };
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
  const sessionTree = await upgradeSessionTree({ base, backupBase });
  const retire = createRetirement(base, backupBase);
  const retired = [];
  const runtimeRoot = path.join(base, WORKSPACE_LAYOUT.RUNTIME_DIR);
  for await (const sessionDir of walkSessionDirectories(base, runtimeRoot)) {
    retired.push(...(await retireSessionArtifacts({ base, sessionDir, retire })));
  }
  return { sessionTree, retired };
}
