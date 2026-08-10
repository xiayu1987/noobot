#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from "node:child_process";

const supported = /\.(?:cjs|js|json|md|mjs|vue|yaml|yml)$/i;
const ignored = /(?:^|\/)(?:build|coverage|dist|node_modules|report|vendor|workspace)(?:\/|$)|(?:^|\/)assets\/.*\.js$/;

function changedFiles(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" })
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const files = [
  ...changedFiles(["diff", "--name-only", "--diff-filter=ACMR", "HEAD^", "HEAD"]),
  ...changedFiles(["diff", "--name-only", "--diff-filter=ACMR"]),
  ...changedFiles(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
].filter((file, index, all) => all.indexOf(file) === index)
  .filter((file) => supported.test(file) && !ignored.test(file));

if (!files.length) {
  console.log("[format-check] no changed source files to check");
  process.exit(0);
}

console.log(`[format-check] checking ${files.length} changed file(s)`);
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prettier", "--check", ...files], {
  stdio: "inherit",
});
