/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { lstat, mkdir, readFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { resolveSessionTreeChain } from "@noobot/workspace-protocol/session-tree";
import {
  SESSION_TREE_REJECTION,
  SESSION_TREE_SHAPE,
  buildSessionTree,
  classifySessionTree,
  listSessionTreePlacements,
  rebuildSessionTree,
} from "@noobot/session-repair";
import {
  createDurableFilePublisher,
  syncStorageDirectory,
} from "../shared/storage/durable-file.js";
import { fsRename, fsRm } from "../shared/storage/fs-adapter.js";
import { readSessionDirectory } from "./session-directory-walk.js";
import { PartitionJournalOwner } from "../session/partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "../session/partition-storage/partition-reader-access.js";
import { isPlainObject } from "@noobot/shared/value";

const JSON_DOCUMENT_STATE = Object.freeze({
  MISSING: "missing",
  UNPARSABLE: "unparsable",
  PARSED: "parsed",
});

async function readJsonDocument(filePath) {
  let raw;
  try {
    raw = await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { state: JSON_DOCUMENT_STATE.MISSING, document: null };
    }
    throw error;
  }
  let document;
  try {
    document = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { state: JSON_DOCUMENT_STATE.UNPARSABLE, document: null, raw };
  }
  return { state: JSON_DOCUMENT_STATE.PARSED, document, raw };
}

function isBelowBase(relative) {
  return (
    relative &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function prepareDirectory(base, directory) {
  if (!isBelowBase(path.relative(base, directory)))
    throw new TypeError(`Expected directory below ${base}: ${directory}`);
  await mkdir(directory, { recursive: true });
  for (let current = directory; current !== base; current = path.dirname(current)) {
    await syncStorageDirectory(path.dirname(current));
  }
}

async function syncRetirement(source, target) {
  await syncStorageDirectory(path.dirname(target));
  await syncStorageDirectory(path.dirname(source));
}

async function moveToBackup(base, backupBase, relativePath) {
  const source = path.join(base, relativePath);
  const target = path.join(backupBase, relativePath);
  await prepareDirectory(base, path.dirname(target));
  await fsRename(source, target);
  await syncRetirement(source, target);
  return target;
}

async function readSessionDocuments(sessionRoot, partitionAccess, segments = []) {
  const documents = [];
  const sessionDir = path.join(sessionRoot, ...segments);
  const { children, authority } = await readSessionDirectory(sessionDir);
  if (segments.length && authority !== null) {
    if (authority !== "partition")
      throw Object.assign(
        new Error(`Unsupported session storage remains in the active tree: ${sessionDir}`),
        { code: "SESSION_STORAGE_FORMAT_UNSUPPORTED" },
      );
    const document = await partitionAccess.readPlacement({
      sessionDir,
      sessionId: segments.at(-1),
    });
    if (document === null)
      throw Object.assign(
        new Error(`Tree upgrade encountered an unpublished session: ${sessionDir}`),
        {
          code: "SESSION_STORAGE_UPGRADE_BLOCKED",
        },
      );
    documents.push({ segments, document });
  }
  for (const entry of children) {
    documents.push(
      ...(await readSessionDocuments(sessionRoot, partitionAccess, [...segments, entry.name])),
    );
  }
  return documents;
}

const SESSION_TREE_UPGRADE_ACTION = Object.freeze({
  [SESSION_TREE_SHAPE.LEGACY]: "mapped",
  [SESSION_TREE_SHAPE.PARENT_ONLY]: "caller-filled",
});

function hasSessionTreeAncestors(chain, byPath) {
  let ancestorPath = "";
  for (let index = 0; index < chain.length - 1; index++) {
    ancestorPath = path.join(ancestorPath, chain[index]);
    if (!byPath.has(ancestorPath)) return false;
  }
  return true;
}

function resolveSessionTreeUpgrade({ document, shape, documents }) {
  if (shape === SESSION_TREE_SHAPE.INVALID) {
    return { action: "rebuilt", ...rebuildSessionTree(documents) };
  }
  const { placements, rejected } = listSessionTreePlacements(document);
  const byPath = new Map(documents.map((entry) => [path.join(...entry.segments), entry]));
  const entries = [];
  for (const { sessionId, segments } of placements) {
    const chain = segments.slice(1);
    const entry = byPath.get(path.join(...chain));
    if (!entry) {
      rejected.push({ sessionId, reason: SESSION_TREE_REJECTION.REPOSITORY_MISSING });
    } else if (!hasSessionTreeAncestors(chain, byPath)) {
      rejected.push({ sessionId, reason: SESSION_TREE_REJECTION.PARENT_REJECTED });
    } else {
      entries.push({ ...entry.document, document: entry.document });
    }
  }
  return { action: SESSION_TREE_UPGRADE_ACTION[shape], ...buildSessionTree(entries), rejected };
}

function isPlacedInTree(tree, segments) {
  const sessionId = segments.at(-1);
  if (!Object.hasOwn(tree.nodes, sessionId)) return false;
  const chain = resolveSessionTreeChain(tree, sessionId);
  return chain.length === segments.length && chain.every((id, index) => id === segments[index]);
}

function planUnplacedSessions(documents, tree) {
  const retiredPrefixes = [];
  documents.sort((left, right) => left.segments.length - right.segments.length);
  for (const { segments } of documents) {
    if (isPlacedInTree(tree, segments)) continue;
    const covered = retiredPrefixes.some((prefix) =>
      prefix.every((segment, index) => segments[index] === segment),
    );
    if (covered) continue;
    retiredPrefixes.push(segments);
  }
  return retiredPrefixes;
}

const { writeDurableReplacement: publishTreeFile } = createDurableFilePublisher((file, id) =>
  path.join(path.dirname(file), `.noobot-atomic-${id}`),
);

function corruptPlan(message) {
  return Object.assign(new Error(message), { code: "SESSION_STORAGE_CORRUPT" });
}

async function directoryExists(directory) {
  try {
    if (!(await lstat(directory)).isDirectory()) throw corruptPlan(`Not a directory: ${directory}`);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function validRetirement(segments) {
  return (
    Array.isArray(segments) &&
    segments.length &&
    segments.every(
      (segment) =>
        typeof segment === "string" &&
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !/[\\/:]/u.test(segment),
    )
  );
}

function requireTreeUpgradePlan(plan, planFile) {
  if (
    !isPlainObject(plan) ||
    plan.version !== 1 ||
    classifySessionTree(plan.tree) !== SESSION_TREE_SHAPE.CURRENT ||
    !["mapped", "caller-filled", "rebuilt"].includes(plan.action) ||
    typeof plan.hasOriginal !== "boolean" ||
    !Array.isArray(plan.repairedCallers) ||
    !Array.isArray(plan.rejected) ||
    !Array.isArray(plan.retirements) ||
    !plan.retirements.every(validRetirement) ||
    !(plan.backup === null
      ? !plan.hasOriginal && !plan.retirements.length
      : typeof plan.backup === "string" &&
        isBelowBase(plan.backup) &&
        path.normalize(plan.backup) === plan.backup)
  )
    throw corruptPlan(`Invalid session tree upgrade plan: ${planFile}`);
  return plan;
}

async function completeRetirement(base, backupBase, segments) {
  const relativePath = path.join(WORKSPACE_LAYOUT.SESSION_DIR, ...segments);
  const source = path.join(base, relativePath);
  const target = path.join(backupBase, relativePath);
  const sourceExists = await directoryExists(source);
  const targetExists = await directoryExists(target);
  if (sourceExists && !targetExists) await moveToBackup(base, backupBase, relativePath);
  else if (!sourceExists && targetExists) await syncRetirement(source, target);
  else if (sourceExists)
    throw Object.assign(new Error(`Retirement target already exists: ${target}`), {
      code: "EEXIST",
    });
  else throw corruptPlan(`Missing session retirement at both ${source} and ${target}`);
  return { path: relativePath, backupPath: target };
}

async function finishTreeUpgrade(base, planFile, treeFile, plan) {
  const { backup, hasOriginal, tree, action, repairedCallers, rejected, retirements } = plan;
  const backupBase = backup === null ? null : path.join(base, backup);
  const backupPath = hasOriginal ? path.join(backupBase, WORKSPACE_LAYOUT.SESSION_TREE_FILE) : null;
  if (backupPath !== null) await readFile(backupPath);
  await syncStorageDirectory(path.dirname(planFile));
  const retiredSessions = [];
  for (const segments of retirements) {
    retiredSessions.push(await completeRetirement(base, backupBase, segments));
  }
  await publishTreeFile(treeFile, `${JSON.stringify(tree, null, 2)}\n`);
  await fsRm(planFile);
  await syncStorageDirectory(path.dirname(planFile));
  return {
    path: WORKSPACE_LAYOUT.SESSION_TREE_FILE,
    action,
    backupPath,
    nodes: Object.keys(tree.nodes).length,
    repairedCallers,
    rejected,
    retiredSessions,
  };
}

export function ensureSessionTree({ base, backupBase }) {
  return upgradeSessionTree({ base, backupBase, missingOnly: true });
}

export function rebuildStoredSessionTree({ base, backupBase }) {
  return upgradeSessionTree({ base, backupBase, rebuild: true });
}

async function upgradeSessionTree({ base, backupBase, missingOnly, rebuild = false }) {
  base = path.resolve(base);
  const treeFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const planFile = path.join(base, WORKSPACE_LAYOUT.SESSION_TREE_UPGRADE_FILE);
  const pending = await readJsonDocument(planFile);
  if (pending.state !== JSON_DOCUMENT_STATE.MISSING) {
    return finishTreeUpgrade(
      base,
      planFile,
      treeFile,
      requireTreeUpgradePlan(pending.document, planFile),
    );
  }
  const current = await readJsonDocument(treeFile);
  const missing = current.state === JSON_DOCUMENT_STATE.MISSING;
  if (missingOnly && !missing) return null;
  const shape = classifySessionTree(current.document);
  if (!rebuild && shape === SESSION_TREE_SHAPE.CURRENT) return null;
  const sessionRoot = path.join(base, WORKSPACE_LAYOUT.SESSION_DIR);
  await using owner = new PartitionJournalOwner({
    durableAncestor: path.resolve(base),
    maxJournals: 1,
    allowNewJournals: false,
  });
  const partitionAccess = createPartitionSessionReaderAccess({
    acquireJournal: owner.acquire.bind(owner),
    withJournalRemoval: owner.withRemoval.bind(owner),
  });
  const documents = await readSessionDocuments(sessionRoot, partitionAccess);
  if (missing && !documents.length && !missingOnly && !rebuild) return null;
  const upgrade = resolveSessionTreeUpgrade({
    document: current.document,
    shape: rebuild ? SESSION_TREE_SHAPE.INVALID : shape,
    documents,
  });
  const duplicates = upgrade.rejected.filter(
    ({ reason }) => reason === SESSION_TREE_REJECTION.DUPLICATE_SESSION,
  );
  if (duplicates.length)
    throw Object.assign(new Error("Tree upgrade cannot retire ambiguous session identities"), {
      code: "SESSION_STORAGE_CORRUPT",
      details: { rejected: duplicates },
    });
  for (const { segments } of documents) {
    if (!isPlacedInTree(upgrade.tree, segments))
      throw Object.assign(
        new Error(
          `Legacy tree upgrade would discard a published session: ${path.join(...segments)}`,
        ),
        {
          code: "SESSION_STORAGE_CORRUPT",
        },
      );
  }
  const retirements = planUnplacedSessions(documents, upgrade.tree);
  const plan = requireTreeUpgradePlan(
    {
      ...upgrade,
      version: 1,
      backup: missing && !retirements.length ? null : path.relative(base, backupBase),
      hasOriginal: !missing,
      retirements,
    },
    planFile,
  );
  if (!missing) {
    const backupPath = path.join(base, plan.backup, WORKSPACE_LAYOUT.SESSION_TREE_FILE);
    await prepareDirectory(base, path.dirname(backupPath));
    await publishTreeFile(backupPath, current.raw);
  }
  await prepareDirectory(base, path.dirname(planFile));
  await publishTreeFile(planFile, `${JSON.stringify(plan)}\n`);
  return finishTreeUpgrade(base, planFile, treeFile, plan);
}
