#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { runCjkLiteralCheck } from "./lib/i18n-scan.mjs";

const CJK_ALLOWED_FILES = new Set([
  "plugin/noobot-plugin-harness/frontend/i18n.js",
  "plugin/noobot-plugin-workflow/frontend/i18n.js",
]);
const CJK_ALLOWED_DIRS = [
  "plugin/noobot-plugin-harness/frontend/i18n",
  "plugin/noobot-plugin-harness/frontend/__tests__",
  "plugin/noobot-plugin-workflow/frontend/i18n",
  "plugin/noobot-plugin-workflow/frontend/__tests__",
];

function isInAllowedDir(relativePath) {
  return CJK_ALLOWED_DIRS.some((dir) =>
    relativePath === dir || relativePath.startsWith(`${dir}${path.sep}`));
}

const ok = runCjkLiteralCheck({
  targetDirs: [
    "plugin/noobot-plugin-harness/frontend",
    "plugin/noobot-plugin-workflow/frontend",
  ],
  fileExtensions: new Set([".vue", ".js"]),
  isAllowed: (relativePath) => CJK_ALLOWED_FILES.has(relativePath) || isInAllowedDir(relativePath),
  successMessage: "✅ plugin frontend i18n literal check passed.",
  failureMessage: "❌ Found non-i18n CJK literals in plugin frontends:",
});

process.exit(ok ? 0 : 1);
