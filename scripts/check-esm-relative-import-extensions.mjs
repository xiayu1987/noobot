/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { init, parse } from "es-module-lexer";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSourceRoots = [
  "agent",
  "agent-proxy",
  "client",
  "i18n",
  "model-proxy",
  "plugin",
  "runtime-events",
  "sanitize",
  "scripts",
  "service",
  "shared",
  "user-template",
  "workflow",
];
const ignoredDirectories = new Set([
  ".git",
  ".noobot",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "test-results",
  "vendor",
  "workspace",
]);
const inspectedExtension = /\.(?:[cm]?[jt]s|[jt]sx|vue)$/i;
const resolutionExtensions = [
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".vue",
  ".json",
];

function toPosix(file) {
  return file.split(path.sep).join("/");
}

function splitResourceSuffix(specifier) {
  const suffixAt = specifier.search(/[?#]/);
  if (suffixAt < 0) return { pathname: specifier, suffix: "" };
  return { pathname: specifier.slice(0, suffixAt), suffix: specifier.slice(suffixAt) };
}

function hasExplicitExtension(specifier) {
  const { pathname } = splitResourceSuffix(specifier);
  return path.posix.extname(pathname) !== "";
}

function resolveCandidates(importer, specifier) {
  const { pathname: relativePath, suffix } = splitResourceSuffix(specifier);
  const basePath = path.resolve(path.dirname(importer), relativePath);
  const candidates = [];
  for (const extension of resolutionExtensions) {
    const file = `${basePath}${extension}`;
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      candidates.push({ file, replacement: `${relativePath}${extension}${suffix}` });
    }
  }
  if (fs.statSync(basePath, { throwIfNoEntry: false })?.isDirectory()) {
    for (const extension of resolutionExtensions) {
      const file = path.join(basePath, `index${extension}`);
      if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
        const separator = relativePath.endsWith("/") ? "" : "/";
        candidates.push({ file, replacement: `${relativePath}${separator}index${extension}${suffix}` });
      }
    }
  }
  return candidates;
}

function scriptRegions(file, source) {
  if (!file.endsWith(".vue")) return [{ source, offset: 0 }];
  const regions = [];
  const pattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const match of source.matchAll(pattern)) {
    const script = match[1];
    regions.push({ source: script, offset: match.index + match[0].indexOf(script) });
  }
  return regions;
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function literalRange(moduleImport, region) {
  if (moduleImport.d < 0) {
    return { start: region.offset + moduleImport.s, end: region.offset + moduleImport.e };
  }
  return { start: region.offset + moduleImport.s + 1, end: region.offset + moduleImport.e - 1 };
}

function inspectComputedRelativeImport(moduleImport, region, file, fullSource) {
  if (moduleImport.d < 0 || moduleImport.n !== undefined) return null;
  const raw = region.source.slice(moduleImport.s, moduleImport.e);
  const body = /^["'`]/.test(raw) ? raw.slice(1, -1) : raw;
  if (!body.startsWith("./") && !body.startsWith("../")) return null;
  if (hasExplicitExtension(body.replaceAll(/\$\{[^}]*\}/g, "placeholder"))) return null;
  return {
    file,
    line: lineAt(fullSource, region.offset + moduleImport.s),
    specifier: body,
    reason: "computed relative import has no explicit extension",
    replacement: null,
    start: null,
    end: null,
  };
}

export async function inspectSourceFile(file, source = fs.readFileSync(file, "utf8")) {
  await init;
  const violations = [];
  for (const region of scriptRegions(file, source)) {
    let imports;
    try {
      [imports] = parse(region.source, file);
    } catch (error) {
      violations.push({
        file,
        line: lineAt(source, region.offset + Number(error.idx || 0)),
        specifier: "",
        reason: `module parse failed: ${error.message}`,
        replacement: null,
        start: null,
        end: null,
      });
      continue;
    }
    for (const moduleImport of imports) {
      const computedViolation = inspectComputedRelativeImport(moduleImport, region, file, source);
      if (computedViolation) {
        violations.push(computedViolation);
        continue;
      }
      const specifier = moduleImport.n;
      if (typeof specifier !== "string") continue;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      if (hasExplicitExtension(specifier)) continue;
      const candidates = resolveCandidates(file, specifier);
      const range = literalRange(moduleImport, region);
      violations.push({
        file,
        line: lineAt(source, range.start),
        specifier,
        reason: candidates.length === 0
          ? "target not found"
          : candidates.length > 1
            ? `ambiguous target (${candidates.map(({ file: candidate }) => path.basename(candidate)).join(", ")})`
            : "missing explicit extension",
        replacement: candidates.length === 1 ? candidates[0].replacement : null,
        start: range.start,
        end: range.end,
      });
    }
  }
  return violations;
}

function collectSourceFiles(root, sourceRoots) {
  const files = [];
  function walk(directory) {
    if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && inspectedExtension.test(entry.name)) files.push(file);
    }
  }
  for (const sourceRoot of sourceRoots) walk(path.resolve(root, sourceRoot));
  return files.sort();
}

function applyFixes(file, source, violations) {
  const fixes = violations
    .filter(({ replacement, start, end }) => replacement && Number.isInteger(start) && Number.isInteger(end))
    .sort((left, right) => right.start - left.start);
  let result = source;
  for (const fix of fixes) result = `${result.slice(0, fix.start)}${fix.replacement}${result.slice(fix.end)}`;
  if (result !== source) fs.writeFileSync(file, result);
  return fixes.length;
}

export async function checkRepository({ root = repositoryRoot, fix = false, sourceRoots = defaultSourceRoots } = {}) {
  const files = collectSourceFiles(root, sourceRoots);
  const violations = [];
  let fixed = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const fileViolations = await inspectSourceFile(file, source);
    if (fix) fixed += applyFixes(file, source, fileViolations);
    violations.push(...fileViolations);
  }
  const remaining = fix
    ? (await Promise.all(files.map((file) => inspectSourceFile(file)))).flat()
    : violations;
  return { files, violations: remaining, fixed };
}

function formatViolation(root, violation) {
  const relative = toPosix(path.relative(root, violation.file));
  const specifier = violation.specifier ? ` ${JSON.stringify(violation.specifier)}` : "";
  return `${relative}:${violation.line}: ${violation.reason}:${specifier}`;
}

async function main() {
  const fix = process.argv.includes("--fix");
  const result = await checkRepository({ fix });
  if (result.violations.length) {
    console.error([
      "Relative ESM imports must include their real file extension.",
      ...result.violations.map((violation) => formatViolation(repositoryRoot, violation)),
    ].join("\n"));
    process.exitCode = 1;
    return;
  }
  const fixSummary = fix ? `; fixed ${result.fixed} import(s)` : "";
  console.log(`ESM relative import extension guard passed (${result.files.length} source files${fixSummary}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
