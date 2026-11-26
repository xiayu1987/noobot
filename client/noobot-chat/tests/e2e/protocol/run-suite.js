/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [suite, ...args] = process.argv.slice(2);
const suiteOptions = new Map([
  ["all", []],
  ["smoke", ["--grep", "@smoke"]],
  ["core", ["--grep", "@smoke|@core"]],
  ["full", []],
  ["perf", ["--grep", "@perf", "--retries=0"]],
  ["perf-single", ["--project", "chromium-perf-single", "--grep", "@perf", "--retries=0"]],
]);
if (!suiteOptions.has(suite)) throw new Error(`Unknown protocol suite: ${suite}`);

const env = { ...process.env };
delete env.NOOBOT_E2E_FULL_SUITE;
if (suite === "full") env.NOOBOT_E2E_FULL_SUITE = "1";

const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const config = fileURLToPath(new URL("./playwright.protocol.config.js", import.meta.url));
const { error, signal, status } = spawnSync(
  process.execPath,
  [cli, "test", "-c", config, ...suiteOptions.get(suite), ...args],
  { env, stdio: "inherit" },
);
if (error) throw error;
if (signal) throw new Error(`Playwright terminated by ${signal}`);
process.exitCode = status;
