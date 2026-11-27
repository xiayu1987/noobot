#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from "node:child_process";
import { existsSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(new URL("../.git", import.meta.url))) {
  for (const hook of ["pre-commit", "commit-msg", "pre-push"]) {
    chmodSync(new URL(`../hooks/${hook}`, import.meta.url), 0o755);
  }
  execFileSync("git", ["config", "--local", "core.hooksPath", "hooks"], { cwd: root });
  process.stdout.write("Repository commit and push hooks installed.\n");
}
