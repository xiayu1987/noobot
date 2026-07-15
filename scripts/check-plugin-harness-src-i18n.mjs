#!/usr/bin/env node
import path from "node:path";
import { runCjkLiteralCheck } from "./lib/i18n-scan.mjs";

// Transitional allowlist: parser/regex compatibility and centralized dictionary.
const CJK_ALLOWED_FILES = new Set([
  "plugin/noobot-plugin-harness/src/i18n.js",
]);
const CJK_ALLOWED_DIR = "plugin/noobot-plugin-harness/src/i18n";

const ok = runCjkLiteralCheck({
  targetDirs: ["plugin/noobot-plugin-harness/src"],
  fileExtensions: new Set([".js"]),
  isAllowed: (relativePath) =>
    CJK_ALLOWED_FILES.has(relativePath)
    || relativePath === CJK_ALLOWED_DIR
    || relativePath.startsWith(`${CJK_ALLOWED_DIR}${path.sep}`),
  successMessage: "✅ plugin harness src i18n literal check passed.",
  failureMessage: "❌ Found non-i18n CJK literals in plugin harness src:",
});

process.exit(ok ? 0 : 1);
