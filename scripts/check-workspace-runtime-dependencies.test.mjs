/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checkerPath = fileURLToPath(
  new URL("./check-workspace-runtime-dependencies.mjs", import.meta.url),
);

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("workspace runtime dependency check rejects a missing internal package link", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-workspace-runtime-deps-"));
  try {
    await writeJson(path.join(root, "package.json"), {
      private: true,
      workspaces: ["consumer", "protocol"],
    });
    await writeJson(path.join(root, "consumer", "package.json"), {
      name: "consumer",
      dependencies: { "@noobot/protocol": "file:../protocol" },
    });
    await writeJson(path.join(root, "protocol", "package.json"), {
      name: "@noobot/protocol",
    });

    const missing = spawnSync(process.execPath, [checkerPath, "--quiet"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /consumer: @noobot\/protocol/);

    await writeJson(path.join(root, "node_modules", "@noobot", "protocol", "package.json"), {
      name: "@noobot/protocol",
    });
    const complete = spawnSync(process.execPath, [checkerPath, "--quiet"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(complete.status, 0, complete.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
