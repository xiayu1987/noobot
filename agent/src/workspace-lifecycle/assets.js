/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  WORKSPACE_ASSET_ACTION,
  WORKSPACE_LAYOUT,
  WORKSPACE_SECTIONS,
  createEmptyWorkspaceAssetState,
  parseWorkspaceAssetState,
  planWorkspaceAssetSync,
  renderWorkspaceAssetState,
} from "@noobot/workspace-protocol";

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function hashFile(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function collectFileHashes(base, relativeDir) {
  const hashes = {};
  const visit = async (relativePath) => {
    let entries;
    try {
      entries = await readdir(path.join(base, relativePath), { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const item of entries) {
      const child = path.join(relativePath, item.name);
      if (item.isDirectory()) await visit(child);
      else if (item.isFile()) hashes[toPosix(child)] = await hashFile(path.join(base, child));
    }
  };
  await visit(relativeDir);
  return hashes;
}

function sectionRoots(sections) {
  return sections.flatMap((name) => WORKSPACE_SECTIONS[name].paths);
}

function isInsideRoots(relativePath, roots) {
  return roots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`));
}

async function collectPackageHashes(base, roots) {
  const merged = {};
  for (const root of roots) Object.assign(merged, await collectFileHashes(base, root));
  return merged;
}

async function collectUserHashes(base, relativePaths) {
  const hashes = {};
  for (const relativePath of relativePaths) {
    try {
      hashes[relativePath] = await hashFile(path.join(base, relativePath));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return hashes;
}

async function readAssetState(base) {
  const statePath = path.join(base, WORKSPACE_LAYOUT.ASSET_STATE_FILE);
  try {
    return parseWorkspaceAssetState(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return createEmptyWorkspaceAssetState();
    throw error;
  }
}

async function applyAction(base, assetPackageBase, item) {
  const target = path.join(base, item.relativePath);
  if (item.action === WORKSPACE_ASSET_ACTION.REMOVE) {
    await rm(target, { force: true });
    return;
  }
  if (item.action === WORKSPACE_ASSET_ACTION.KEEP) return;
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(assetPackageBase, item.relativePath), target);
}

export async function applyWorkspaceAssets({ base, assetPackageBase, operation, sections }) {
  const roots = sectionRoots(sections);
  if (!roots.length) return [];
  const installedState = await readAssetState(base);
  const scopedInstalled = Object.fromEntries(
    Object.entries(installedState.files).filter(([key]) => isInsideRoots(key, roots)),
  );
  const packageFiles = await collectPackageHashes(assetPackageBase, roots);
  const trackedPaths = new Set([...Object.keys(packageFiles), ...Object.keys(scopedInstalled)]);
  const plan = planWorkspaceAssetSync({
    operation,
    packageFiles,
    installedState: { ...installedState, files: scopedInstalled },
    userFiles: await collectUserHashes(base, trackedPaths),
  });
  for (const item of plan.actions) await applyAction(base, assetPackageBase, item);
  const outside = Object.fromEntries(
    Object.entries(installedState.files).filter(([key]) => !isInsideRoots(key, roots)),
  );
  const statePath = path.join(base, WORKSPACE_LAYOUT.ASSET_STATE_FILE);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    renderWorkspaceAssetState({ files: { ...outside, ...plan.nextState.files } }),
  );
  return plan.actions;
}
