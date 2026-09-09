/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export function createGuardViolations(options = {}) {
  const { root, label } = options;
  if (typeof root !== "string" || !root) {
    throw new TypeError("createGuardViolations requires options.root as a non-empty string");
  }
  if (typeof label !== "string" || !label) {
    throw new TypeError("createGuardViolations requires options.label as a non-empty string");
  }
  const violations = [];

  const add = (message) => {
    violations.push(message);
  };

  const assertAbsent = async (relativePath, reason) => {
    if (typeof reason !== "string" || !reason) {
      throw new TypeError("assertAbsent requires a non-empty reason");
    }
    try {
      await access(path.join(root, relativePath));
    } catch {
      return;
    }
    add(`${relativePath}: ${reason}`);
  };

  const report = (summary) => {
    if (violations.length) {
      console.error(`[${label}] failed\n${violations.join("\n")}`);
      process.exitCode = 1;
      return;
    }
    console.log(summary ? `[${label}] ok (${summary})` : `[${label}] ok`);
  };

  return { violations, add, assertAbsent, report };
}
