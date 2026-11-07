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

test("packaged desktop diagnoses malformed user JSON and accepts an explicit user correction", async () => {
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
    assert.equal(await readFile(configPath, "utf8"), malformed);
    assert.deepEqual(fs.readdirSync(existingUserPath), ["config.json"]);
    assert.ok(
      logLines.some(
        (line) => line.includes(configPath) && line.includes("INVALID_CONFIG_DOCUMENT"),
      ),
    );
    assert.equal(logLines.join("\n").includes("must-not-appear-in-log"), false);
    await writeFile(configPath, JSON.stringify({ default_provider: "gpt_5_6_sol" }), "utf8");
    logLines.length = 0;
    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });
    assert.equal(JSON.parse(await readFile(configPath, "utf8")).default_provider, "gpt_5_6_sol");
    assert.equal(
      logLines.some((line) => line.includes("INVALID_CONFIG_DOCUMENT")),
      false,
    );
  } finally {
    await fixture.restore();
  }
});
