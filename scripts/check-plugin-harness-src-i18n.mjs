#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIR = "plugin/noobot-plugin-harness/src";
const FILE_EXT = new Set([".js"]);
const CJK_RE = /[\u4e00-\u9fff]/;

// Transitional allowlist: parser/regex compatibility and centralized dictionary.
const CJK_ALLOWED_FILES = new Set([
  "plugin/noobot-plugin-harness/src/i18n.js",
]);

function walkFiles(dir) {
  const result = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!FILE_EXT.has(path.extname(entry.name))) continue;
      result.push(abs);
    }
  }
  return result;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, index) => {
    if (CJK_RE.test(line)) {
      hits.push({ line: index + 1, text: line.trim() });
    }
  });
  return hits;
}

const absDir = path.resolve(ROOT, TARGET_DIR);
const files = walkFiles(absDir);
const problems = [];
for (const file of files) {
  const relPath = path.relative(ROOT, file);
  if (CJK_ALLOWED_FILES.has(relPath)) continue;
  const hits = checkFile(file);
  if (!hits.length) continue;
  problems.push({ file: relPath, hits });
}

if (!problems.length) {
  console.log("✅ plugin harness src i18n literal check passed.");
  process.exit(0);
}

console.error("❌ Found non-i18n CJK literals in plugin harness src:");
for (const item of problems) {
  console.error(`\n- ${item.file}`);
  item.hits.slice(0, 10).forEach((hit) => {
    console.error(`  ${hit.line}: ${hit.text}`);
  });
  if (item.hits.length > 10) {
    console.error(`  ... and ${item.hits.length - 10} more`);
  }
}
process.exit(1);
