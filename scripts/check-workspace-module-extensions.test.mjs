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
import { measureWorkspaceModuleExtensions } from "./check-workspace-module-extensions.mjs";

async function write(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function writeJson(filePath, value) {
  await write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test("workspace module extension check enforces the package-level ESM suffix", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-workspace-module-extensions-"));
  try {
    await writeJson(path.join(root, "package.json"), {
      private: true,
      workspaces: ["module-package", "commonjs-package"],
    });
    await writeJson(path.join(root, "module-package", "package.json"), {
      name: "module-package",
      type: "module",
    });
    await writeJson(path.join(root, "commonjs-package", "package.json"), {
      name: "commonjs-package",
    });
    await write(path.join(root, "module-package", "src", "valid.js"), "export {};\n");
    await write(path.join(root, "commonjs-package", "standalone.mjs"), "export {};\n");
    await write(path.join(root, "root-script.mjs"), "export {};\n");
    await write(path.join(root, "module-package", "dist", "generated.mjs"), "export {};\n");
    await write(path.join(root, "module-package", "logs", "output.mjs"), "export {};\n");

    const valid = await measureWorkspaceModuleExtensions(root);
    assert.equal(valid.mjsInModuleWorkspace.total, 0);

    await write(path.join(root, "module-package", "src", "invalid.mjs"), "export {};\n");
    const invalid = await measureWorkspaceModuleExtensions(root);
    assert.deepEqual(Object.keys(invalid.mjsInModuleWorkspace.files), [
      "module-package/src/invalid.mjs",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
