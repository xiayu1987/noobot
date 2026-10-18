/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { init, parse } from "es-module-lexer";
import { vueScriptRegions } from "./lib/vue-script-regions.mjs";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { repositoryRoot } from "./quality/repository-files.mjs";
import { getFirstPartyCodeFiles } from "./quality/source-inventory.mjs";

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
        candidates.push({
          file,
          replacement: `${relativePath}${separator}index${extension}${suffix}`,
        });
      }
    }
  }
  return candidates;
}

export const ESM_SOURCE_EXTENSIONS = Object.freeze(
  resolutionExtensions.filter((ext) => ext !== ".json"),
);

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function literalRange(moduleImport, region) {
  if (moduleImport.type !== "dynamic") {
    return { start: region.offset + moduleImport.start, end: region.offset + moduleImport.end };
  }
  return {
    start: region.offset + moduleImport.start + 1,
    end: region.offset + moduleImport.end - 1,
  };
}

function isRelative(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function computedRelativeImport(moduleImport, region, source) {
  if (moduleImport.type !== "dynamic" || !moduleImport.glob) return null;
  const raw = region.source.slice(moduleImport.start, moduleImport.end);
  const body = /^["'`]/.test(raw) ? raw.slice(1, -1) : raw;
  if (!isRelative(body)) return null;
  if (hasExplicitExtension(body.replaceAll(/\$\{[^}]*\}/g, "placeholder"))) return null;
  return {
    rule: "computedRelativeImport",
    line: lineAt(source, region.offset + moduleImport.start),
    specifier: body,
    replacement: null,
  };
}

function unresolvedImport(file, moduleImport, region, source) {
  const { specifier } = moduleImport;
  if (typeof specifier !== "string" || !isRelative(specifier)) return null;
  if (hasExplicitExtension(specifier)) return null;
  const candidates = resolveCandidates(file, specifier);
  const range = literalRange(moduleImport, region);
  const base = { line: lineAt(source, range.start), specifier, replacement: null };
  if (candidates.length === 0) return { ...base, rule: "targetNotFound" };
  if (candidates.length > 1) {
    const names = candidates.map(({ file: candidate }) => path.basename(candidate)).join(", ");
    return { ...base, rule: "ambiguousTarget", specifier: `${specifier} (${names})` };
  }
  return {
    ...base,
    rule: "missingExtension",
    replacement: { ...range, text: candidates[0].replacement },
  };
}

function parseFailure(source, region, error) {
  const offset = Number.isInteger(error.idx) ? region.offset + error.idx : region.offset;
  return {
    rule: "unanalyzableSource",
    line: lineAt(source, offset),
    specifier: `module parse failed: ${error.message}`,
    replacement: null,
  };
}

export async function inspectSourceFile(file, source) {
  await init;
  let regions;
  try {
    regions = vueScriptRegions(file, source);
  } catch (error) {
    return [{ rule: "unanalyzableSource", line: 1, specifier: error.message, replacement: null }];
  }
  const findings = [];
  for (const region of regions) {
    let imports;
    try {
      [imports] = parse(region.source, file);
    } catch (error) {
      findings.push(parseFailure(source, region, error));
      continue;
    }
    for (const moduleImport of imports) {
      const finding =
        computedRelativeImport(moduleImport, region, source) ??
        unresolvedImport(file, moduleImport, region, source);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

export async function measureEsmRelativeImportExtensions(root, files) {
  const measured = emptyRuleMeasurements(CHECK);
  for (const file of files) {
    const absolute = path.join(root, file);
    for (const finding of await inspectSourceFile(absolute, fs.readFileSync(absolute, "utf8"))) {
      addHit(measured[finding.rule], {
        file,
        line: finding.line,
        message: JSON.stringify(finding.specifier),
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "esm-relative-import-extensions",
  description: "Relative ESM imports name their real file extension",
  rules: {
    missingExtension: {
      description: "Relative import resolves to exactly one file but omits its extension",
      hint: "run npm run fix:esm-import-extensions, or write the real extension",
    },
    ambiguousTarget: {
      description: "Extensionless relative import matches more than one file",
      hint: "write the extension of the intended target explicitly",
    },
    targetNotFound: {
      description: "Extensionless relative import matches no file",
      hint: "fix the path or write the real extension of the target",
    },
    computedRelativeImport: {
      description: "Computed relative dynamic import has no explicit extension",
      hint: "end the template with the real extension, e.g. `./locales/${name}.js`",
    },
    unanalyzableSource: {
      description: "Source or Vue script block cannot be parsed for imports",
      hint: "fix the syntax error so imports can be verified",
    },
  },
  exemptions: [],
  baseline: {
    missingExtension: 0,
    ambiguousTarget: 0,
    targetNotFound: 0,
    computedRelativeImport: 0,
    unanalyzableSource: 0,
    exemptions: 0,
  },
  measure: async () =>
    measureEsmRelativeImportExtensions(
      repositoryRoot,
      await getFirstPartyCodeFiles({
        repositoryRoot,
        extensions: ESM_SOURCE_EXTENSIONS,
        includeTests: true,
      }),
    ),
});

await runCheckWhenMain(CHECK, import.meta.url);
