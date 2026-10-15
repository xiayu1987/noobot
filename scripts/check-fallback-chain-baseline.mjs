/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Linter } from "eslint";
import * as espree from "espree";
import * as prettier from "prettier";
import vueParser, { parse as parseVue } from "vue-eslint-parser";
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

export const EXEMPTIONS = Object.freeze({
  externalFields: Object.freeze({
    reason: "wire fields owned by LangChain or model vendors; aliases cannot be converged locally",
    names: Object.freeze([
      "lc_kwargs",
      "lc_name",
      "additional_kwargs",
      "response_metadata",
      "usage_metadata",
      "tool_calls",
      "tool_call_id",
      "tool_use_id",
      "call_id",
      "tool_name",
      "tool_choice",
      "input_schema",
      "image_url",
      "b64_json",
    ]),
  }),
  errorObjects: Object.freeze({
    reason: "caught errors have no fixed shape; every operand reads the same error object",
    roots: Object.freeze(["error", "err", "cause"]),
  }),
  boundaryFiles: Object.freeze([
    Object.freeze({ prefix: "model-runtime/src/adapters/", reason: "vendor wire format adapters" }),
    Object.freeze({ prefix: "context-protocol/src/message/", reason: "LangChain message codec" }),
    Object.freeze({ prefix: "shared/value.js", reason: "implementation of text() itself" }),
  ]),
});

export const TARGETS = Object.freeze({
  start: Object.freeze({ fallbackChain: 920, inlineTrim: 148, typeCheck: 175 }),
  goal: Object.freeze({ fallbackChain: 460, inlineTrim: 74, typeCheck: 88 }),
  minBatchDrop: 120,
});

const PLAIN_OBJECT_HELPER_NAMES = new Set([
  "isPlainObject",
  "isObject",
  "isRecord",
  "isObjectLike",
]);

const EXTERNAL_FIELD_SET = new Set(EXEMPTIONS.externalFields.names);
const ERROR_ROOT_SET = new Set(EXEMPTIONS.errorObjects.roots);

export function isBoundaryFile(file) {
  return EXEMPTIONS.boundaryFiles.some(({ prefix }) => file.startsWith(prefix));
}

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

function memberPropertyNames(node) {
  const names = [];
  let current = unwrapMember(node);
  while (current.type === "MemberExpression") {
    const { property } = current;
    if (!current.computed && property.type === "Identifier") names.push(property.name);
    else if (property.type === "Literal" && typeof property.value === "string")
      names.push(property.value);
    current = unwrapMember(current.object);
  }
  return names;
}

function isExemptChain(fields) {
  if (
    fields.some((field) => memberPropertyNames(field).some((name) => EXTERNAL_FIELD_SET.has(name)))
  )
    return true;
  return fields.every((field) => {
    const base = rootObject(field);
    return base.type === "Identifier" && ERROR_ROOT_SET.has(base.name);
  });
}

function classifyChain(node) {
  const fields = flattenChain(node, node.operator).filter(isFieldOperand);
  if (fields.length < 2) return null;
  return isExemptChain(fields) ? "exempt" : "counted";
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
    if (classifyChain(node) === "counted") chains.push(snippet(source, node));
  });
  return chains;
}

function isSingleArgumentCall(node, name) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === name &&
    node.arguments.length === 1
  );
}

function isFallbackExpression(node) {
  return node.type === "LogicalExpression" && FALLBACK_OPERATORS.has(node.operator);
}

export function findInlineTrimFallbacks(
  source,
  filename = "source.js",
  { skipFieldChains = false } = {},
) {
  const isTrimFallback = (node) =>
    isFallbackExpression(node) && !(skipFieldChains && classifyChain(node));
  const hits = [];
  walk(parseSource(source, filename), null, (node) => {
    if (isSingleArgumentCall(node, "text")) {
      if (isTrimFallback(node.arguments[0])) hits.push(snippet(source, node));
      return;
    }
    if (node.type !== "CallExpression" || node.arguments.length) return;
    const callee = unwrapMember(node.callee);
    if (callee.type !== "MemberExpression" || callee.computed) return;
    if (callee.property.name !== "trim" || !isSingleArgumentCall(callee.object, "String")) return;
    if (isTrimFallback(callee.object.arguments[0])) hits.push(snippet(source, node));
  });
  return hits;
}

const TEXT_IMPORT = /import\s*\{[^}]*\btext\b[^}]*\}\s*from/;
const shadowLinter = new Linter({ configType: "flat" });
const SHADOW_CONFIG = [
  {
    files: ["**/*.{js,mjs,cjs,jsx}"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-shadow": "error" },
  },
  {
    files: ["**/*.vue"],
    languageOptions: { parser: vueParser, ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-shadow": "error" },
  },
];

export function findTextShadowing(source, filename = "source.js") {
  if (!TEXT_IMPORT.test(source)) return [];
  return shadowLinter
    .verify(source, SHADOW_CONFIG, { filename })
    .filter((message) => message.ruleId === "no-shadow" && message.message.startsWith("'text' "))
    .map((message) => ({ line: message.line, code: message.message }));
}

function isTypeofObjectTest(node) {
  if (node.type !== "BinaryExpression" || !["===", "=="].includes(node.operator)) return false;
  const [unary, literal] =
    node.left.type === "UnaryExpression" ? [node.left, node.right] : [node.right, node.left];
  return (
    unary.type === "UnaryExpression" && unary.operator === "typeof" && literal.value === "object"
  );
}

function isNotArrayTest(node) {
  return (
    node.type === "UnaryExpression" &&
    node.operator === "!" &&
    node.argument.type === "CallExpression" &&
    unwrapMember(node.argument.callee).type === "MemberExpression" &&
    node.argument.callee.object?.name === "Array" &&
    node.argument.callee.property?.name === "isArray"
  );
}

function isLocalPlainObjectHelper(node) {
  const name =
    node.type === "FunctionDeclaration"
      ? node.id?.name
      : node.type === "VariableDeclarator" &&
          ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init?.type)
        ? node.id?.name
        : "";
  return PLAIN_OBJECT_HELPER_NAMES.has(name);
}

export function findInlineTypeChecks(source, filename = "source.js") {
  const hits = [];
  walk(parseSource(source, filename), null, (node, parent) => {
    if (isLocalPlainObjectHelper(node)) {
      hits.push(snippet(source, node.type === "VariableDeclarator" ? node.id : node.id));
      return;
    }
    const isAndHead =
      node.type === "LogicalExpression" &&
      node.operator === "&&" &&
      !(parent?.type === "LogicalExpression" && parent.operator === "&&");
    if (!isAndHead) return;
    const operands = flattenChain(node, "&&");
    if (operands.some(isTypeofObjectTest) && operands.some(isNotArrayTest))
      hits.push(snippet(source, node));
  });
  return hits;
}

const isSharedValueModule = (file) => file === "shared/value.js";

export const RULES = Object.freeze({
  fallbackChain: {
    title: "回退链",
    find: findFallbackChains,
    includeFile: (file) => isFirstPartyProductionPath(file) && !isBoundaryFile(file),
    hint: "read the single writer field instead",
  },
  inlineTrim: {
    title: "内联 trim 兜底",
    find: (source, file) =>
      findInlineTrimFallbacks(source, file, { skipFieldChains: isFirstPartyProductionPath(file) }),
    includeFile: (file) => !isTestFilePath(file) && !isBoundaryFile(file),
    hint: 'use text(x) from "@noobot/shared/value" instead of String(x || d).trim()',
  },
  typeCheck: {
    title: "内联类型判断",
    find: findInlineTypeChecks,
    includeFile: (file) => !isTestFilePath(file) && !isSharedValueModule(file),
    hint: 'use isPlainObject from "@noobot/shared/value" instead of local object type checks',
  },
  textShadow: {
    title: "遮蔽 text()",
    find: findTextShadowing,
    includeFile: () => true,
    hint: "rename the local binding; files importing text() must not rebind text",
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

function targetTotal(counts, names) {
  return names.reduce((total, name) => total + sumCounts(counts[name] ?? {}), 0);
}

const sumValues = (table) => Object.values(table).reduce((total, value) => total + value, 0);

export function evaluateTargets({ previous, next, mode, targets = TARGETS }) {
  const start = sumValues(targets.start);
  const goal = sumValues(targets.goal);
  const names = Object.keys(targets.goal);
  const nextTotal = targetTotal(next, names);
  const violations = [];
  if (nextTotal > start)
    violations.push(`target total ${nextTotal} exceeds start ceiling ${start}`);
  if (mode === "update" && nextTotal > goal) {
    const dropped = targetTotal(previous, names) - nextTotal;
    if (dropped < targets.minBatchDrop)
      violations.push(
        `batch dropped ${dropped}, at least ${targets.minBatchDrop} required until goal ${goal}`,
      );
  }
  const progress = `${nextTotal}/${start} → goal ${goal}, ${Math.max(nextTotal - goal, 0)} left`;
  return { violations, progress };
}

export function findRebaseIncreases(previous, next) {
  return Object.keys(RULES)
    .filter((name) => previous[name])
    .map((name) => [name, sumCounts(previous[name]), sumCounts(next[name] ?? {})])
    .filter(([, before, after]) => after > before)
    .map(([name, before, after]) => `rebase raises ${name} from ${before} to ${after}`);
}

async function writeBaseline(markdown, measured) {
  const lowered = Object.fromEntries(
    Object.keys(RULES).map((name) => [name, sortCounts(measured[name])]),
  );
  await writeFile(BASELINE_PATH, `${JSON.stringify(lowered, null, 2)}\n`);
  await writeFile(INVENTORY_DOC_PATH, await renderInventoryDoc(markdown, lowered));
  return lowered;
}

function fail(lines) {
  console.error(lines.join("\n"));
  process.exitCode = 1;
}

async function main(argv) {
  const measured = await measureRules();
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  const markdown = await readFile(INVENTORY_DOC_PATH, "utf8");
  if (argv.includes("--rebase")) {
    const { violations, progress } = evaluateTargets({ previous: baseline, next: measured });
    violations.push(...findRebaseIncreases(baseline, measured));
    if (violations.length) return fail(violations);
    const lowered = await writeBaseline(markdown, measured);
    console.log(`Fallback baseline rebased to ${describeTotals(lowered)} (${progress})`);
    return;
  }
  const increases = [];
  const decreases = [];
  for (const [name, rule] of Object.entries(RULES)) {
    const result = compareWithBaseline(measured[name], baseline[name] ?? {});
    if (result.increases.length) {
      increases.push(`[${name}] ${rule.hint}:`, ...result.increases);
    }
    decreases.push(...result.decreases.map((line) => `[${name}] ${line}`));
  }
  if (increases.length) return fail(["New fallback patterns are not allowed:", ...increases]);
  if (argv.includes("--update")) {
    const { violations, progress } = evaluateTargets({
      previous: baseline,
      next: measured,
      mode: "update",
    });
    if (violations.length) return fail(violations);
    const lowered = await writeBaseline(markdown, measured);
    console.log(`Fallback baseline lowered to ${describeTotals(lowered)} (${progress})`);
    return;
  }
  const violations = decreases.map((line) => `stale baseline, run with --update: ${line}`);
  if ((await renderInventoryDoc(markdown, baseline)) !== markdown) {
    violations.push("docs/fallback-chain-inventory.md module table is stale, run with --update");
  }
  const target = evaluateTargets({ previous: baseline, next: baseline });
  violations.push(...target.violations);
  if (violations.length) return fail(violations);
  console.log(`Fallback baseline passed (${describeTotals(measured)}; ${target.progress})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  await main(process.argv.slice(2));
