/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as espree from "espree";
import * as prettier from "prettier";
import { parse as parseVue } from "vue-eslint-parser";
import { getFirstPartyProductionFiles } from "./quality/source-inventory.mjs";

const root = path.resolve(import.meta.dirname, "..");
export const BASELINE_PATH = path.join(root, "scripts/quality/fallback-chain-baseline.json");
export const INVENTORY_DOC_PATH = path.join(root, "docs/fallback-chain-inventory.md");
const FALLBACK_OPERATORS = new Set(["||", "??"]);
const CONDITION_PARENTS = new Set([
  "IfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
]);
const CONSTANT_TABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
const SKIPPED_KEYS = new Set(["parent", "loc", "range", "tokens", "comments", "templateBody"]);

function flattenChain(node, operator, output = []) {
  if (node.type === "LogicalExpression" && node.operator === operator) {
    flattenChain(node.left, operator, output);
    flattenChain(node.right, operator, output);
  } else output.push(node);
  return output;
}

function unwrapMember(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}

function rootObject(node) {
  let current = unwrapMember(node);
  while (current.type === "MemberExpression") current = unwrapMember(current.object);
  return current;
}

function isFieldOperand(node) {
  if (unwrapMember(node).type !== "MemberExpression") return false;
  const base = rootObject(node);
  return !(base.type === "Identifier" && CONSTANT_TABLE_NAME.test(base.name));
}

function isConditionPosition(node, parent) {
  if (!parent) return false;
  if (CONDITION_PARENTS.has(parent.type)) return parent.test === node;
  if (parent.type === "ConditionalExpression") return parent.test === node;
  if (parent.type === "UnaryExpression") return parent.operator === "!";
  return parent.type === "LogicalExpression" && parent.operator === "&&";
}

function parseSource(source, filename) {
  const options = { ecmaVersion: "latest", sourceType: "module", loc: true, range: true };
  if (filename.endsWith(".vue")) return parseVue(source, options);
  return espree.parse(source, { ...options, ecmaFeatures: { jsx: filename.endsWith(".jsx") } });
}

export function findFallbackChains(source, filename = "source.js") {
  const chains = [];
  const visit = (node, parent) => {
    if (!node || typeof node.type !== "string") return;
    const isChainHead =
      node.type === "LogicalExpression" &&
      FALLBACK_OPERATORS.has(node.operator) &&
      !(parent?.type === "LogicalExpression" && parent.operator === node.operator);
    if (isChainHead && !isConditionPosition(node, parent)) {
      const operands = flattenChain(node, node.operator);
      if (operands.filter(isFieldOperand).length >= 2) {
        chains.push({
          line: node.loc.start.line,
          code: source.slice(node.range[0], node.range[1]).replace(/\s+/g, " "),
        });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (SKIPPED_KEYS.has(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, node));
      else if (value && typeof value.type === "string") visit(value, node);
    }
  };
  visit(parseSource(source, filename), null);
  return chains;
}

export async function measureFallbackChains({ repositoryRoot = root } = {}) {
  const files = await getFirstPartyProductionFiles({
    repositoryRoot,
    extensions: [".js", ".mjs", ".cjs", ".jsx", ".vue"],
  });
  const counts = {};
  for (const relativePath of files) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    const total = findFallbackChains(source, relativePath).length;
    if (total) counts[relativePath.replaceAll("\\", "/")] = total;
  }
  return counts;
}

export function compareWithBaseline(measured, baseline) {
  const increases = [];
  const decreases = [];
  for (const file of new Set([...Object.keys(measured), ...Object.keys(baseline)])) {
    const actual = measured[file] ?? 0;
    const allowed = baseline[file] ?? 0;
    if (actual > allowed) increases.push(`${file}: ${actual} exceeds baseline ${allowed}`);
    if (actual < allowed) decreases.push(`${file}: ${actual} below baseline ${allowed}`);
  }
  return { increases, decreases };
}

export function sumCounts(counts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

const MODULE_SECTION_START = "<!-- fallback-chain-modules:start -->";
const MODULE_SECTION_END = "<!-- fallback-chain-modules:end -->";

export function moduleOf(file) {
  const segments = file.split("/");
  return ["plugin", "client"].includes(segments[0]) ? segments.slice(0, 2).join("/") : segments[0];
}

export function renderModuleSection(baseline) {
  const modules = {};
  for (const [file, count] of Object.entries(baseline)) {
    const name = moduleOf(file);
    modules[name] ??= { files: 0, chains: 0 };
    modules[name].files += 1;
    modules[name].chains += count;
  }
  const rows = Object.entries(modules)
    .sort(
      ([leftName, left], [rightName, right]) =>
        right.chains - left.chains || leftName.localeCompare(rightName),
    )
    .map(([name, { files, chains }]) => `| \`${name}\` | ${files} | ${chains} |`);
  return [
    MODULE_SECTION_START,
    "",
    `总计：${sumCounts(baseline)} 条，${Object.keys(baseline).length} 个文件。`,
    "",
    "| 模块 | 文件数 | 回退链 |",
    "| --- | --- | --- |",
    ...rows,
    "",
    MODULE_SECTION_END,
  ].join("\n");
}

export function replaceModuleSection(markdown, baseline) {
  const begin = markdown.indexOf(MODULE_SECTION_START);
  const end = markdown.indexOf(MODULE_SECTION_END);
  if (begin < 0 || end < begin)
    throw new Error("fallback chain inventory doc is missing module markers");
  return (
    markdown.slice(0, begin) +
    renderModuleSection(baseline) +
    markdown.slice(end + MODULE_SECTION_END.length)
  );
}

async function renderInventoryDoc(markdown, baseline) {
  const config = await prettier.resolveConfig(INVENTORY_DOC_PATH);
  return prettier.format(replaceModuleSection(markdown, baseline), {
    ...config,
    filepath: INVENTORY_DOC_PATH,
  });
}

function sortCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function main(argv) {
  const measured = await measureFallbackChains();
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  const { increases, decreases } = compareWithBaseline(measured, baseline);
  if (increases.length) {
    console.error(
      `New fallback chains are not allowed; read the single writer field instead:\n${increases.join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  const markdown = await readFile(INVENTORY_DOC_PATH, "utf8");
  if (argv.includes("--update")) {
    const lowered = sortCounts(measured);
    await writeFile(BASELINE_PATH, `${JSON.stringify(lowered, null, 2)}\n`);
    await writeFile(INVENTORY_DOC_PATH, await renderInventoryDoc(markdown, lowered));
    console.log(`Fallback chain baseline lowered to ${sumCounts(lowered)}`);
    return;
  }
  const violations = decreases.map((line) => `stale baseline, run with --update: ${line}`);
  if ((await renderInventoryDoc(markdown, baseline)) !== markdown) {
    violations.push("docs/fallback-chain-inventory.md module table is stale, run with --update");
  }
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(`Fallback chain baseline passed (${sumCounts(measured)} chains)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  await main(process.argv.slice(2));
