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
  path.join(repoRoot, "plugin/noobot-plugin-character/frontend"),
];
const sharedPopperRoots = [
  path.join(projectRoot, "src"),
  path.join(repoRoot, "client/startup/src"),
  path.join(repoRoot, "plugin/noobot-plugin-harness/frontend"),
  path.join(repoRoot, "plugin/noobot-plugin-workflow/frontend"),
  path.join(repoRoot, "plugin/noobot-plugin-character/frontend"),
];
const inspectedExtensions = new Set([".css", ".js", ".jsx", ".ts", ".tsx", ".vue"]);
const tokenLocations = [
  path.join(projectRoot, "src/shared/styles/tokens"),
  path.join(projectRoot, "src/shared/utils/markdown-copy.js"),
  path.join(repoRoot, "client/startup/src/style.css"),
];
const formContractFiles = [
  {
    filePath: path.join(projectRoot, "src/shared/styles/integrations/element-plus.css"),
    selectors: [
      ".el-input__wrapper",
      ".el-textarea__inner",
      ".el-select__wrapper",
      ".el-input-number",
      ".el-switch",
      ".el-checkbox",
      ".el-radio",
      ".el-slider",
      ".el-form-item__label",
    ],
  },
  {
    filePath: path.join(repoRoot, "client/startup/src/style.css"),
    selectors: [
      ".el-input__wrapper",
      ".el-select__wrapper",
      ".el-checkbox__inner",
      ".el-form-item__label",
      ".el-form-item__error",
    ],
  },
];
const violations = [];
const checks = [
  ["transition: all is forbidden", /\btransition(?:-property)?\s*:\s*all\b/i],
  [
    "literal border radius must use a design token",
    /\bborder-radius\s*:\s*[^;\n}]*(?:\d+px|999px)/i,
  ],
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

function inspectEmptyStyleRules(filePath, source) {
  const styleRegions = filePath.endsWith(".vue")
    ? Array.from(source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi), (match) => ({
        source: match[1],
        offset: (match.index || 0) + match[0].indexOf(match[1]),
      }))
    : [{ source, offset: 0 }];
  for (const region of styleRegions) {
    for (const match of region.source.matchAll(/(?:^|})\s*([^{}]+)\{\s*\}/g)) {
      const selector = String(match[1] || "").trim();
      if (!selector || selector.startsWith("@")) continue;
      const lineNumber = source.slice(0, region.offset + (match.index || 0)).split(/\r?\n/).length;
      violations.push(`${path.relative(repoRoot, filePath)}:${lineNumber}: empty style rule is forbidden`);
    }
  }
}

function inspectFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [message, pattern] of checks) {
      if (!pattern.test(line)) continue;
      if (
        (message.includes("color") || message.includes("radius")) &&
        isTokenDeclaration(filePath, line)
      )
        continue;
      violations.push(`${path.relative(repoRoot, filePath)}:${index + 1}: ${message}`);
    }
  });
  if (filePath.endsWith(".css") || filePath.endsWith(".vue")) {
    inspectEmptyStyleRules(filePath, source);
  }

  if (
    path.extname(filePath).toLowerCase() !== ".vue" ||
    !sharedPopperRoots.some((root) => isInside(root, filePath))
  )
    return;
  const dropdownContracts = [
    [
      /<el-select(?=[\s>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g,
      "noobot-select-popper",
      "el-select must use the shared select popper",
    ],
    [
      /<el-dropdown(?=[\s>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g,
      "noobot-dropdown-popper",
      "el-dropdown must use the shared dropdown popper",
    ],
  ];
  for (const [pattern, requiredClass, message] of dropdownContracts) {
    for (const match of source.matchAll(pattern)) {
      if (match[0].includes(requiredClass)) continue;
      const lineNumber = source.slice(0, match.index).split(/\r?\n/).length;
      violations.push(`${path.relative(repoRoot, filePath)}:${lineNumber}: ${message}`);
    }
  }
}

function inspectDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) inspectDirectory(filePath);
    else if (entry.isFile() && inspectedExtensions.has(path.extname(entry.name).toLowerCase()))
      inspectFile(filePath);
  }
}

sourceRoots.forEach(inspectDirectory);
for (const { filePath, selectors } of formContractFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const selector of selectors) {
    if (source.includes(selector)) continue;
    violations.push(
      `${path.relative(repoRoot, filePath)}: shared form contract is missing ${selector}`,
    );
  }
}
if (violations.length) {
  console.error(`[frontend-styles] ${violations.length} violation(s):`);
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exitCode = 1;
} else {
  console.log(
    "[frontend-styles] ok: tokens, transitions, dropdown poppers and form controls use the shared style contract",
  );
}
