/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { measureWorkspaceRuntimeDependencies } from "./check-workspace-runtime-dependencies.mjs";

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hitFiles(measured) {
  return {
    missingLink: measured.missingLink.samples,
    identityMismatch: measured.identityMismatch.samples,
  };
}

test("workspace runtime dependency check classifies missing and mismatched links", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-workspace-runtime-deps-"));
  const installedProtocol = path.join(root, "node_modules", "@noobot", "protocol", "package.json");
  try {
    await writeJson(path.join(root, "package.json"), {
      private: true,
      workspaces: ["consumer", "protocol"],
    });
    await writeJson(path.join(root, "consumer", "package.json"), {
      name: "consumer",
      dependencies: { "@noobot/protocol": "file:../protocol", external: "1.0.0" },
    });
    await writeJson(path.join(root, "protocol", "package.json"), { name: "@noobot/protocol" });

    assert.deepEqual(hitFiles(await measureWorkspaceRuntimeDependencies(root)), {
      missingLink: ["consumer/package.json @noobot/protocol is not installed"],
      identityMismatch: [],
    });

    await writeJson(installedProtocol, { name: "@noobot/other" });
    assert.deepEqual(hitFiles(await measureWorkspaceRuntimeDependencies(root)), {
      missingLink: [],
      identityMismatch: [
        "consumer/package.json node_modules/@noobot/protocol resolves to @noobot/other",
      ],
    });

    await writeJson(installedProtocol, { name: "@noobot/protocol" });
    assert.deepEqual(hitFiles(await measureWorkspaceRuntimeDependencies(root)), {
      missingLink: [],
      identityMismatch: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace runtime dependency check surfaces a corrupt installed manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-workspace-runtime-deps-"));
  try {
    await writeJson(path.join(root, "package.json"), { workspaces: ["consumer", "protocol"] });
    await writeJson(path.join(root, "consumer", "package.json"), {
      name: "consumer",
      optionalDependencies: { protocol: "file:../protocol" },
    });
    await writeJson(path.join(root, "protocol", "package.json"), { name: "protocol" });
    await mkdir(path.join(root, "node_modules", "protocol"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "protocol", "package.json"), "{", "utf8");

    await assert.rejects(measureWorkspaceRuntimeDependencies(root), SyntaxError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
