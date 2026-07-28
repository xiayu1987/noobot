/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "src");

const retiredDirectories = [
  "composables",
  "services",
  "modules/message",
  "shared/execution",
  "shared/message",
  "shared/models",
  "shared/process",
  "shared/stores",
];

const violations = [];

function inspectDirectory(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const extensions = new Set(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.extname(entry.name)),
  );
  if (extensions.has(".vue") && (extensions.has(".js") || extensions.has(".mjs"))) {
    violations.push(`${path.relative(projectRoot, directory)} mixes Vue and JavaScript files`);
  }
  for (const entry of entries) {
    if (entry.isDirectory()) inspectDirectory(path.join(directory, entry.name));
  }
}

for (const relativeDirectory of retiredDirectories) {
  if (fs.existsSync(path.join(sourceRoot, relativeDirectory))) {
    violations.push(`src/${relativeDirectory} is retired; use an owning module or infrastructure layer`);
  }
}

inspectDirectory(sourceRoot);

if (violations.length) {
  console.error(`[frontend-structure] ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("[frontend-structure] ok: semantic layers are clean and Vue/JavaScript files are separated");
}
