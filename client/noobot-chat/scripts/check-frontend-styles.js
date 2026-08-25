/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(projectRoot, "../..");
const sourceRoots = [
  path.join(projectRoot, "src"),
  path.join(repoRoot, "client/startup/src"),
  path.join(repoRoot, "plugin/noobot-plugin-harness/frontend"),
  path.join(repoRoot, "plugin/noobot-plugin-workflow/frontend"),
];
const inspectedExtensions = new Set([".css", ".js", ".jsx", ".ts", ".tsx", ".vue"]);
const tokenLocations = [
  path.join(projectRoot, "src/shared/styles/tokens"),
  path.join(projectRoot, "src/shared/utils/markdown-copy.js"),
  path.join(repoRoot, "client/startup/src/style.css"),
];
const violations = [];
const checks = [
  ["transition: all is forbidden", /\btransition(?:-property)?\s*:\s*all\b/i],
  ["literal border radius must use a design token", /\bborder-radius\s*:\s*[^;\n}]*(?:\d+px|999px)/i],
  ["literal hex color must be declared in a token location", /#[0-9a-f]{3,8}\b/i],
  ["literal rgb color must be declared in a token location", /\brgba?\(\s*\d/i],
];

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isTokenDeclaration(filePath, line) {
  if (!tokenLocations.some((location) => isInside(location, filePath))) return false;
  return /^\s*--[\w-]+\s*:/.test(line) || filePath.endsWith("markdown-copy.js");
}

function inspectFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [message, pattern] of checks) {
      if (!pattern.test(line)) continue;
      if ((message.includes("color") || message.includes("radius")) && isTokenDeclaration(filePath, line)) continue;
      violations.push(`${path.relative(repoRoot, filePath)}:${index + 1}: ${message}`);
    }
  });
}

function inspectDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) inspectDirectory(filePath);
    else if (entry.isFile() && inspectedExtensions.has(path.extname(entry.name).toLowerCase())) inspectFile(filePath);
  }
}

sourceRoots.forEach(inspectDirectory);
if (violations.length) {
  console.error(`[frontend-styles] ${violations.length} violation(s):`);
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exitCode = 1;
} else {
  console.log("[frontend-styles] ok: colors, radii and transitions use the shared style contract");
}
