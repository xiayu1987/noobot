#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rules = Object.freeze([
  {
    file: "path-resolver/src/platform.js",
    patterns: [/\["win",\s*"win32",\s*"windows"\]/, /\["mac",\s*"macos",\s*"darwin",\s*"osx"\]/],
  },
  {
    file: "execution-isolation-protocol/src/protocol.js",
    patterns: [/platform[^\n]*===?[^\n]*["']win32["']/, /["']cmd\.exe["']|["']\/bin\/sh["']/],
  },
  {
    file: "agent/src/shared/storage/atomic-file-write.js",
    patterns: [/EPERM|EACCES|EBUSY/, /platform[^\n]*===?/],
  },
  {
    file: "agent/src/tools/execution/native-script-runtime.js",
    patterns: [/process\.platform[^\n]*(?:soffice|libreoffice)/i],
  },
  {
    file: "agent/src/tools/execution/native-script-tool.js",
    patterns: [/process\.platform\s*!==?\s*["']win32["']/],
  },
  {
    file: "agent/src/tools/execution/script-tool/process-exec.js",
    patterns: [
      /process\.platform\s*[!=]==?\s*["']win32["']/,
      /["']where["']\s*:\s*["']which["']/,
      /process\.kill\(-/,
      /shift_jis|euc-kr|windows-1252/,
    ],
  },
  {
    file: "service/services/openvscode/process.js",
    patterns: [/process\.platform\s*===?\s*["']win32["']/, /["']taskkill["']/],
  },
  {
    file: "client/shared/electron/runtime/services.js",
    patterns: [/process\.platform\s*===?\s*["']win32["']/, /["']taskkill["']/, /["']npm\.cmd["']/],
  },
]);

const violations = [];
for (const rule of rules) {
  const source = readFileSync(path.join(root, rule.file), "utf8");
  for (const pattern of rule.patterns) {
    if (pattern.test(source)) violations.push(`${rule.file}: ${pattern}`);
  }
}

if (violations.length) {
  console.error(
    "Platform compatibility facts must be implemented by @noobot/platform-compatibility:",
  );
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Platform compatibility boundary check passed.");
