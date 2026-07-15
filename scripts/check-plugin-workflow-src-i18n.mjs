#!/usr/bin/env node
import { runCjkLiteralCheck } from "./lib/i18n-scan.mjs";

const CJK_ALLOWED_FILES = new Set([
  "plugin/noobot-plugin-workflow/src/core/i18n.js",
]);

const ok = runCjkLiteralCheck({
  targetDirs: ["plugin/noobot-plugin-workflow/src"],
  fileExtensions: new Set([".js"]),
  isAllowed: (relativePath) => CJK_ALLOWED_FILES.has(relativePath),
  successMessage: "✅ plugin workflow src i18n literal check passed.",
  failureMessage: "❌ Found non-i18n CJK literals in plugin workflow src:",
});

process.exit(ok ? 0 : 1);
