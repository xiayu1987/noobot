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
import {
  getFirstPartyCodeFiles,
  isFirstPartyProductionPath,
  isTestFilePath,
} from "./quality/source-inventory.mjs";

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

function walk(node, parent, visitor) {
  if (!node || typeof node.type !== "string") return;
  visitor(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, node, visitor));
    else if (value && typeof value.type === "string") walk(value, node, visitor);
  }
}

function snippet(source, node) {
  return { line: node.loc.start.line, code: source.slice(...node.range).replace(/\s+/g, " ") };
}

function parseSource(source, filename) {
  const options = { ecmaVersion: "latest", sourceType: "module", loc: true, range: true };
  if (filename.endsWith(".vue")) return parseVue(source, options);
  return espree.parse(source, { ...options, ecmaFeatures: { jsx: filename.endsWith(".jsx") } });
}

export function findFallbackChains(source, filename = "source.js") {
  const chains = [];
  walk(parseSource(source, filename), null, (node, parent) => {
    const isChainHead =
      node.type === "LogicalExpression" &&
      FALLBACK_OPERATORS.has(node.operator) &&
      !(parent?.type === "LogicalExpression" && parent.operator === node.operator);
    if (!isChainHead || isConditionPosition(node, parent)) return;
    const operands = flattenChain(node, node.operator);
    if (operands.filter(isFieldOperand).length >= 2) chains.push(snippet(source, node));
  });
  return chains;
}

function isStringCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "String" &&
    node.arguments.length === 1
  );
}

export function findInlineTrimFallbacks(source, filename = "source.js") {
  const hits = [];
  walk(parseSource(source, filename), null, (node) => {
    if (node.type !== "CallExpression" || node.arguments.length) return;
    const callee = unwrapMember(node.callee);
    if (callee.type !== "MemberExpression" || callee.computed) return;
    if (callee.property.name !== "trim" || !isStringCall(callee.object)) return;
    const argument = callee.object.arguments[0];
    if (argument.type === "LogicalExpression" && FALLBACK_OPERATORS.has(argument.operator)) {
      hits.push(snippet(source, node));
    }
  });
  return hits;
}

export const RULES = Object.freeze({
  fallbackChain: {
    title: "回退链",
    find: findFallbackChains,
    includeFile: isFirstPartyProductionPath,
    hint: "read the single writer field instead",
  },
  inlineTrim: {
    title: "内联 trim 兜底",
    find: findInlineTrimFallbacks,
    includeFile: (file) => !isTestFilePath(file),
    hint: 'use text(x) from "@noobot/shared/value" instead of String(x || d).trim()',
  },
});

export async function measureRules({ repositoryRoot = root } = {}) {
  const files = await getFirstPartyCodeFiles({
    repositoryRoot,
    extensions: [".js", ".mjs", ".cjs", ".jsx", ".vue"],
    includeTests: true,
  });
  const measured = Object.fromEntries(Object.keys(RULES).map((name) => [name, {}]));
  for (const relativePath of files) {
    const file = relativePath.replaceAll("\\", "/");
    const rules = Object.entries(RULES).filter(([, rule]) => rule.includeFile(file));
    if (!rules.length) continue;
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    for (const [name, rule] of rules) {
      const total = rule.find(source, file).length;
      if (total) measured[name][file] = total;
    }
  }
  return measured;
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
  const ruleNames = Object.keys(RULES);
  const modules = {};
  for (const name of ruleNames) {
    for (const [file, count] of Object.entries(baseline[name] ?? {})) {
      const row = (modules[moduleOf(file)] ??= Object.fromEntries(ruleNames.map((n) => [n, 0])));
      row[name] += count;
    }
  }
  const total = (row) => ruleNames.reduce((sum, name) => sum + row[name], 0);
  const rows = Object.entries(modules)
    .sort(
      ([leftName, left], [rightName, right]) =>
        total(right) - total(left) || leftName.localeCompare(rightName),
    )
    .map(
      ([module, row]) => `| \`${module}\` | ${ruleNames.map((name) => row[name]).join(" | ")} |`,
    );
  const totals = ruleNames.map((name) => {
    const counts = baseline[name] ?? {};
    return `${RULES[name].title} ${sumCounts(counts)} 处 / ${Object.keys(counts).length} 个文件`;
  });
  return [
    MODULE_SECTION_START,
    "",
    `总计：${totals.join("；")}。`,
    "",
    `| 模块 | ${ruleNames.map((name) => RULES[name].title).join(" | ")} |`,
    `| --- | ${ruleNames.map(() => "---").join(" | ")} |`,
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

function describeTotals(counts) {
  return Object.keys(RULES)
    .map((name) => `${name}=${sumCounts(counts[name] ?? {})}`)
    .join(", ");
}

async function main(argv) {
  const measured = await measureRules();
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  const increases = [];
  const decreases = [];
  for (const [name, rule] of Object.entries(RULES)) {
    const result = compareWithBaseline(measured[name], baseline[name] ?? {});
    if (result.increases.length) {
      increases.push(`[${name}] ${rule.hint}:`, ...result.increases);
    }
    decreases.push(...result.decreases.map((line) => `[${name}] ${line}`));
  }
  if (increases.length) {
    console.error(`New fallback patterns are not allowed:\n${increases.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  const markdown = await readFile(INVENTORY_DOC_PATH, "utf8");
  if (argv.includes("--update")) {
    const lowered = Object.fromEntries(
      Object.keys(RULES).map((name) => [name, sortCounts(measured[name])]),
    );
    await writeFile(BASELINE_PATH, `${JSON.stringify(lowered, null, 2)}\n`);
    await writeFile(INVENTORY_DOC_PATH, await renderInventoryDoc(markdown, lowered));
    console.log(`Fallback baseline lowered to ${describeTotals(lowered)}`);
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
  console.log(`Fallback baseline passed (${describeTotals(measured)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  await main(process.argv.slice(2));
