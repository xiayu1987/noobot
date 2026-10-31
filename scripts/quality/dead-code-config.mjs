/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { isObjectLike } from "@noobot/shared/value";
import { getFirstPartyCodeFiles, readRootWorkspacePaths } from "./source-inventory.mjs";

const RUNTIME_ENTRIES = Object.freeze({
  ".": [
    "scripts/analyze-log-duplicates.mjs",
    "scripts/capture-character-animation-runtime.mjs",
    "scripts/generate-character-animation-demo.mjs",
    "scripts/migrate-attachment-record-v1.mjs",
    "scripts/remove-source-comments.mjs",
    "scripts/validate-pm2-processes.mjs",
    "scripts/wait-runtime-ready.mjs",
    "scripts/e2e-docker/prepare-workspace.mjs",
    "scripts/lib/runtime-topology-cli.mjs",
  ],
  service: ["scripts/project-launcher.js"],
  agent: ["scripts/model-access-test/public/app.js"],
  "client/shared": ["electron/preload.cjs"],
});

function manifestModules(value) {
  if (!isObjectLike(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "module" && typeof child === "string" ? [child] : manifestModules(child),
  );
}

async function pluginEntries(root, directory) {
  let source;
  try {
    source = await readFile(path.join(root, directory, "manifest.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const manifest = JSON.parse(source);
  return [...Object.values(manifest.entries), ...manifestModules(manifest.contributes)];
}

export async function createDeadCodeConfig(root) {
  const workspacePaths = await readRootWorkspacePaths(root);
  const files = await getFirstPartyCodeFiles({ repositoryRoot: root, includeTests: true });
  const workspaces = {};
  for (const directory of [".", ...workspacePaths]) {
    const prefix = directory === "." ? "" : `${directory}/`;
    const project = files
      .filter((file) =>
        prefix
          ? file.startsWith(prefix)
          : !workspacePaths.some((entry) => file.startsWith(`${entry}/`)),
      )
      .map((file) => file.slice(prefix.length));
    const manifest = JSON.parse(await readFile(path.join(root, directory, "package.json"), "utf8"));
    const runtimeEntries = [
      ...(RUNTIME_ENTRIES[directory] ?? []),
      manifest.build?.afterPack,
    ].filter(Boolean);
    for (const entry of runtimeEntries) await access(path.join(root, directory, entry));
    workspaces[directory] = {
      entry: [
        "{index,cli,main}.{js,mjs,cjs}",
        "src/{index,main}.{js,mjs,cjs}",
        "**/*.{test,spec,e2e}.{js,mjs,cjs}",
        "index.html",
        ...runtimeEntries,
        ...(await pluginEntries(root, directory)),
      ],
      project,
    };
  }
  return { include: ["files", "exports", "nsExports", "dependencies"], workspaces };
}
