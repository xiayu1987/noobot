/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { clientFilePath as path } from "../../path-resolver.js";
import { createDesktopConfigManager } from "../../electron/runtime/config.js";
import { createFixture } from "./desktop-config.test.js";

test("packaged desktop preserves malformed user JSON before restoring it", async () => {
  const fixture = await createFixture();
  try {
    const logLines = [];
    const existingUserPath = path.join(fixture.userDataPath, "workspace/broken-user");
    await mkdir(existingUserPath, { recursive: true });
    const configPath = path.join(existingUserPath, "config.json");
    const malformed = '{"api_key":"must-not-appear-in-log" trailing';
    await writeFile(configPath, malformed, "utf8");
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
      appendDesktopLog: (line) => logLines.push(line),
    });
    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).default_provider, "openai");
    const backupName = fs
      .readdirSync(existingUserPath)
      .find((name) => name.startsWith("config.json.invalid-"));
    assert.ok(backupName);
    assert.equal(await readFile(path.join(existingUserPath, backupName), "utf8"), malformed);
    assert.ok(logLines.some((line) => line.includes("invalid JSON preserved")));
    assert.equal(logLines.join("\n").includes("must-not-appear-in-log"), false);
  } finally {
    await fixture.restore();
  }
});
