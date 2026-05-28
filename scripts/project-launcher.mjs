#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFilePath), "..");
const serviceDir = path.join(rootDir, "service");
const launcherPath = path.join(serviceDir, "scripts", "project-launcher.js");
const forwardedArgs = process.argv.slice(2);

const result = spawnSync(process.execPath, [launcherPath, ...forwardedArgs], {
  cwd: serviceDir,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`[project-launcher-wrapper] failed: ${String(result.error?.message || result.error)}`);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (typeof result.signal === "string" && result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(1);
