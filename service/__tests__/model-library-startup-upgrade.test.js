/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MODEL_LIBRARY_VERSION, listModelLibraryOptions } from "@noobot/model-protocol";
import { upgradeGlobalModelLibrary } from "../bootstrap/upgrade-global-model-library.js";

async function fileSnapshot(filePath) {
  const handle = await open(filePath, "r");
  try {
    const content = await handle.readFile("utf8");
    const { mtimeMs, ino, dev } = await handle.stat();
    return { content, mtimeMs, ino, dev };
  } finally {
    await handle.close();
  }
}

for (const versioned of [false, true]) {
  test(`direct service startup upgrades ${versioned ? "versioned" : "legacy"} global config once`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "noobot-model-library-startup-"));
    const filePath = path.join(root, "global.config.json");
    const alias = listModelLibraryOptions()[0].key;
    const original = `${JSON.stringify({
      ...(versioned ? { model_library_version: MODEL_LIBRARY_VERSION - 1 } : {}),
      default_provider: "retired",
      providers: {
        [alias]: { model: "preserved", api_key: "configured-key", is_custom: false },
        retired: { model: "retired", is_custom: false },
        private: { model: "private", is_custom: true },
      },
    })}\n`;
    try {
      await writeFile(filePath, original);
      const report = await upgradeGlobalModelLibrary(filePath);
      assert.equal(report.changed, true);
      const upgradedText = await readFile(filePath, "utf8");
      const document = JSON.parse(upgradedText);
      assert.equal(document.model_library_version, MODEL_LIBRARY_VERSION);
      assert.equal(document.providers[alias].api_key, "configured-key");
      assert.equal(document.providers[alias].is_custom, !versioned);
      assert.equal(document.providers.private.is_custom, true);
      assert.equal(Boolean(document.providers.retired), !versioned);
      assert.equal(document.default_provider, "retired");
      assert.equal(
        report.issues.some(
          (issue) =>
            issue.path === "default_provider" && issue.code === "MODEL_REFERENCE_NOT_FOUND",
        ),
        versioned,
      );
      for (const { key } of listModelLibraryOptions()) assert.ok(document.providers[key]);
      const backups = (await readdir(root)).filter((name) => name.endsWith(".bak"));
      assert.equal(backups.length, 1);
      assert.equal(await readFile(path.join(root, backups[0]), "utf8"), original);
      const before = await fileSnapshot(filePath);
      const repeatedReport = await upgradeGlobalModelLibrary(filePath);
      assert.equal(repeatedReport.changed, false);
      assert.deepEqual(repeatedReport.issues, report.issues);
      assert.deepEqual(await fileSnapshot(filePath), before);
      assert.equal((await readdir(root)).filter((name) => name.endsWith(".bak")).length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("direct startup reports malformed config without writing or assigning a version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-model-library-startup-"));
  const filePath = path.join(root, "global.config.json");
  try {
    await writeFile(filePath, "{broken");
    await assert.rejects(upgradeGlobalModelLibrary(filePath), SyntaxError);
    assert.equal(await readFile(filePath, "utf8"), "{broken");
    assert.deepEqual(await readdir(root), ["global.config.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
