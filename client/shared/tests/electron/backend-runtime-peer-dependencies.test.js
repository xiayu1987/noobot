/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { clientFilePath as path } from "../../path-resolver.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const backendPluginPackages = [
  "plugin/noobot-plugin-harness/package.json",
  "plugin/noobot-plugin-workflow/package.json",
  "plugin/noobot-plugin-character/package.json",
];

test("backend plugin workspaces keep frontend host peers optional", async () => {
  for (const relativePath of backendPluginPackages) {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
    for (const peerName of Object.keys(packageJson.peerDependencies || {})) {
      assert.equal(
        packageJson.peerDependenciesMeta?.[peerName]?.optional,
        true,
        `${relativePath} peer ${peerName} would be resolved from the registry during backend packaging`,
      );
    }
  }
});
