/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { resolveSessionTreeChain } from "@noobot/workspace-protocol/session-tree";
import { EXECUTION_REPORT_VERSION } from "@noobot/session-protocol/execution-report";
import {
  SESSION_TREE_SHAPE,
  buildSessionTree,
  classifySessionTree,
  listSessionTreePlacements,
  rebuildSessionTree,
} from "@noobot/session-repair";
import { writeFileAtomic } from "../shared/storage/atomic-file-write.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";
import { sessionMutationCoordinator } from "../session/session-mutation-coordinator.js";
import {
  SESSION_ARTIFACT_FILE_NAMES,
  resolveSessionArtifactMutationLock,
} from "../session/session-artifact-files.js";
import {
  EXECUTION_EVENT_INDEX_FILE,
  LEGACY_V2_EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
} from "@noobot/session-protocol/execution-event-index";
import { isPlainObject } from "@noobot/shared/value";

const SKIPPED_RUNTIME_DIRECTORIES = new Set([
  WORKSPACE_LAYOUT.WORKSPACE_BACKUPS_DIR,
  WORKSPACE_LAYOUT.MIGRATION_QUARANTINE_DIR,
  WORKSPACE_LAYOUT.MEMORY_REPAIR_BACKUPS_DIR,
  WORKSPACE_LAYOUT.BROWSER_PROFILES_DIR,
  WORKSPACE_LAYOUT.OPS_WORKDIR,
  WORKSPACE_LAYOUT.PLUGIN_ASSETS_DIR,
]);

const SESSION_ARTIFACT_DIRECTORIES = new Set(Object.values(SESSION_ARTIFACT_FILE_NAMES));
const MUTATION_LOCK_SUFFIX = ".mutation-lock";

const JSON_DOCUMENT_STATE = Object.freeze({
  MISSING: "missing",
  UNPARSABLE: "unparsable",
  PARSED: "parsed",
});

async function readJsonDocument(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return { state: JSON_DOCUMENT_STATE.MISSING, document: null };
    }
    throw error;
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { state: JSON_DOCUMENT_STATE.UNPARSABLE, document: null };
  }
  return { state: JSON_DOCUMENT_STATE.PARSED, document };
}

async function listDirectories(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory(),
    );
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
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

async function readSessionDocuments(sessionRoot, segments = []) {
  const documents = [];
  if (segments.length) {
    const session = await readJsonDocument(
      path.join(sessionRoot, ...segments, SESSION_ARTIFACT_FILE_NAMES.session),
    );
    if (session.state !== JSON_DOCUMENT_STATE.MISSING) {
      documents.push({ segments, document: session.document });
    }
  }
  for (const entry of await listDirectories(path.join(sessionRoot, ...segments))) {
    if (SESSION_ARTIFACT_DIRECTORIES.has(entry.name)) continue;
    if (entry.name.endsWith(MUTATION_LOCK_SUFFIX)) continue;
    documents.push(...(await readSessionDocuments(sessionRoot, [...segments, entry.name])));
  }
  return documents;
}

async function readPlacedSessionDocuments(base, placements) {
  const entries = [];
  for (const { sessionId, parentSessionId, segments } of placements) {
    const session = await readJsonDocument(
      path.join(base, ...segments, SESSION_ARTIFACT_FILE_NAMES.session),
    );
    entries.push({
      sessionId,
      parentSessionId,
      document: session.document,
    });
  }
  return entries;
}

const SESSION_TREE_UPGRADE_ACTION = Object.freeze({
  [SESSION_TREE_SHAPE.LEGACY]: "mapped",
  [SESSION_TREE_SHAPE.PARENT_ONLY]: "caller-filled",
});

async function resolveSessionTreeUpgrade({ sessionRoot, base, document }) {
  const shape = classifySessionTree(document);
  if (shape === SESSION_TREE_SHAPE.CURRENT) return null;
  if (shape === SESSION_TREE_SHAPE.INVALID) {
    return { action: "rebuilt", ...rebuildSessionTree(await readSessionDocuments(sessionRoot)) };
  }
  const { placements, rejected } = listSessionTreePlacements(document);
  const entries = await readPlacedSessionDocuments(base, placements);
  return { action: SESSION_TREE_UPGRADE_ACTION[shape], ...buildSessionTree(entries), rejected };
}

function isPlacedInTree(tree, segments) {
  const sessionId = segments.at(-1);
  if (!Object.hasOwn(tree.nodes, sessionId)) return false;
  const chain = resolveSessionTreeChain(tree, sessionId);
  return chain.length === segments.length && chain.every((id, index) => id === segments[index]);
}

async function retireUnplacedSessions({ sessionRoot, tree, retire }) {
  const retired = [];
  const retiredPrefixes = [];
  const documents = await readSessionDocuments(sessionRoot);
  documents.sort((left, right) => left.segments.length - right.segments.length);
  for (const { segments } of documents) {
    if (isPlacedInTree(tree, segments)) continue;
    const covered = retiredPrefixes.some((prefix) =>
      prefix.every((segment, index) => segments[index] === segment),
    );
    if (covered) continue;
    retiredPrefixes.push(segments);
    const relativePath = path.join(WORKSPACE_LAYOUT.SESSION_DIR, ...segments);
    retired.push({ path: relativePath, backupPath: await retire(relativePath) });
  }
  return retired;
}

async function upgradeSessionTree({ base, retire }) {
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const current = await readJsonDocument(treeFile);
  if (current.state === JSON_DOCUMENT_STATE.MISSING) return null;
  const sessionRoot = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR);
  const upgrade = await resolveSessionTreeUpgrade({
    sessionRoot,
    base,
    document: current.document,
  });
  if (!upgrade) return null;
  const backupPath = await retire(WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  await writeFileAtomic({
    filePath: treeFile,
    content: `${JSON.stringify(upgrade.tree, null, 2)}\n`,
    writeFile,
    rename,
    remove: rm,
  });
  return {
    path: WORKSPACE_LAYOUT.SESSION_TREE_FILE,
    action: upgrade.action,
    backupPath,
    nodes: Object.keys(upgrade.tree.nodes).length,
    repairedCallers: upgrade.repairedCallers,
    rejected: upgrade.rejected,
    retiredSessions: await retireUnplacedSessions({ sessionRoot, tree: upgrade.tree, retire }),
  };
}

function isRetiredJsonDocument({ state, document }, isCurrent) {
  if (state === JSON_DOCUMENT_STATE.UNPARSABLE) return true;
  return !isPlainObject(document) || !isCurrent(document);
}

async function isRetiredExecutionEvents(sessionDir) {
  const index = await readJsonDocument(
    path.join(
      sessionDir,
      SESSION_ARTIFACT_FILE_NAMES.executionEventsDir,
      EXECUTION_EVENT_INDEX_FILE,
    ),
  );
  if (index.state === JSON_DOCUMENT_STATE.MISSING) return false;
  return isRetiredJsonDocument(
    index,
    (document) => document.schemaVersion === LEGACY_V2_EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
  );
}

async function listRetiredReports(sessionDir) {
  const reportsDir = path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.executionReportsDir);
  let names;
  try {
    names = await readdir(reportsDir);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
  const retired = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const report = await readJsonDocument(path.join(reportsDir, name));
    if (report.state === JSON_DOCUMENT_STATE.MISSING) continue;
    if (
      isRetiredJsonDocument(report, (document) => document.version === EXECUTION_REPORT_VERSION)
    ) {
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

export async function upgradeSessionStorage({
  base,
  backupBase,
  onSessionProcessed = ignoreSessionProgress,
}) {
  const retire = createRetirement(base, backupBase);
  const sessionTree = await upgradeSessionTree({ base, retire });
  const retired = [];
  const runtimeRoot = path.join(base, WORKSPACE_LAYOUT.RUNTIME_DIR);
  for await (const sessionDir of walkSessionDirectories(base, runtimeRoot)) {
    retired.push(...(await retireSessionArtifacts({ base, sessionDir, retire })));
    onSessionProcessed();
  }
  return { sessionTree, retired };
}
