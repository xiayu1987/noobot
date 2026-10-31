/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Linter } from "eslint";
import vueParser from "vue-eslint-parser";
import {
  EXEMPTION_KINDS,
  addHit,
  defineCheck,
  emptyMeasurement,
  NO_EXEMPTIONS,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { isBrowserCallback } from "./quality/browser-callbacks.mjs";
import { SKIP_SUBTREE, parseSource, snippet, walk } from "./quality/source-ast.mjs";
import {
  getFirstPartyCodeFiles,
  isFirstPartyProductionPath,
  isTestFilePath,
} from "./quality/source-inventory.mjs";

const root = path.resolve(import.meta.dirname, "..");
const FALLBACK_OPERATORS = new Set(["||", "??"]);
const CONDITION_PARENTS = new Set([
  "IfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
]);
const CONSTANT_TABLE_NAME = /^[A-Z][A-Z0-9_]*$/;

export const CHECK = defineCheck({
  id: "fallback-chain",
  description: "fallback chains, inline text() re-implementations and raw type checks",
  rules: {
    fallbackChain: {
      description: "value-position || / ?? chains reading two or more fields or sources",
      hint: "read the single writer field instead",
    },
    inlineTrim: {
      description: "String(x || d).trim() or text(x || d) re-implementing text() defaults",
      hint: 'use text(x) from "@noobot/shared/value" instead of String(x || d).trim()',
    },
    typeCheck: {
      description: "local plain-object checks duplicating shared isPlainObject",
      hint: 'use isPlainObject from "@noobot/shared/value" instead of local object type checks',
    },
    rawTypeof: {
      description: 'raw typeof x ===/!== "object"/"function" comparisons',
      hint: 'use isFunction/isObjectLike/isPlainObject from "@noobot/shared/value" instead of typeof x ===/!== "object"/"function"',
    },
    textShadow: {
      description: "local bindings shadowing an imported text()",
      hint: "rename the local binding; files importing text() must not rebind text",
    },
  },
  exemptions: [
    {
      id: "vendor-wire-fields",
      kind: EXEMPTION_KINDS.PROPERTY_NAME,
      rules: ["fallbackChain"],
      reason:
        "wire fields owned by LangChain or model vendors; aliases cannot be converged locally",
      match: ["lc_kwargs", "additional_kwargs", "call_id"],
    },
    {
      id: "caught-error-objects",
      kind: EXEMPTION_KINDS.ROOT_IDENTIFIER,
      rules: ["fallbackChain"],
      reason: "caught errors have no fixed shape; every operand reads the same error object",
      match: ["error"],
    },
    {
      id: "vendor-adapters",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["fallbackChain", "inlineTrim"],
      reason: "vendor wire format adapters",
      match: ["model-runtime/src/adapters/"],
    },
    {
      id: "langchain-message-codec",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["fallbackChain"],
      reason: "LangChain message codec",
      match: ["context-protocol/src/message/"],
    },
    {
      id: "shared-value-implementation",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["inlineTrim", "typeCheck", "rawTypeof"],
      reason: "implements text(), isPlainObject, isObjectLike and isFunction themselves",
      match: ["shared/value.js"],
    },
    {
      id: "strict-plain-object",
      kind: EXEMPTION_KINDS.PATH_PREFIX,
      rules: ["typeCheck"],
      reason:
        "requires Object.prototype or null prototype; shared isPlainObject would relax validation",
      match: [
        "attachment-protocol/src/protocol-utils.js",
        "client/noobot-chat/tests/e2e/protocol/helpers/snapshot-assertions.js",
      ],
    },
  ],
  baseline: {
    fallbackChain: 309,
    inlineTrim: 57,
    typeCheck: 0,
    rawTypeof: 472,
    textShadow: 0,
    exemptions: 9,
  },
  measure: (usage) => measureRules(usage),
});

const PLAIN_OBJECT_HELPER_NAMES = new Set([
  "isPlainObject",
  "isObject",
  "isRecord",
  "isObjectLike",
]);

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

function chainFields(node) {
  return flattenChain(node, node.operator).filter(isFieldOperand);
}

function isFieldChain(node) {
  return chainFields(node).length >= 2;
}

function isExemptChain(fields, usage) {
  const names = fields.flatMap(memberPropertyNames).filter(Boolean);
  const vendorHits = names.map((name) =>
    usage.exempts("fallbackChain", EXEMPTION_KINDS.PROPERTY_NAME, name),
  );
  if (vendorHits.some(Boolean)) return true;
  const roots = fields.map(rootObject);
  if (roots.some((base) => base.type !== "Identifier")) return false;
  return usage.exemptsEvery(
    "fallbackChain",
    EXEMPTION_KINDS.ROOT_IDENTIFIER,
    roots.map((base) => base.name),
  );
}

function isConditionPosition(node, parent) {
  if (!parent) return false;
  if (CONDITION_PARENTS.has(parent.type)) return parent.test === node;
  if (parent.type === "ConditionalExpression") return parent.test === node;
  if (parent.type === "UnaryExpression") return parent.operator === "!";
  return parent.type === "LogicalExpression" && parent.operator === "&&";
}

export function findFallbackChains(source, filename, usage) {
  const chains = [];
  walk(parseSource(source, filename), null, (node, parent) => {
    const isChainHead =
      node.type === "LogicalExpression" &&
      FALLBACK_OPERATORS.has(node.operator) &&
      !(parent?.type === "LogicalExpression" && parent.operator === node.operator);
    if (!isChainHead || isConditionPosition(node, parent)) return;
    const fields = chainFields(node);
    if (fields.length >= 2 && !isExemptChain(fields, usage)) chains.push(snippet(source, node));
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
    isFallbackExpression(node) && !(skipFieldChains && isFieldChain(node));
  const hits = [];
  walk(parseSource(source, filename), null, (node, parent) => {
    if (isBrowserCallback(node, parent)) return SKIP_SUBTREE;
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
    if (isBrowserCallback(node, parent)) return SKIP_SUBTREE;
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

const RAW_TYPEOF_KINDS = new Set(["object", "function"]);
const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

function isRawTypeofTest(node) {
  if (node.type !== "BinaryExpression" || !EQUALITY_OPERATORS.has(node.operator)) return false;
  const [unary, literal] =
    node.left.type === "UnaryExpression" ? [node.left, node.right] : [node.right, node.left];
  return (
    unary.type === "UnaryExpression" &&
    unary.operator === "typeof" &&
    literal.type === "Literal" &&
    RAW_TYPEOF_KINDS.has(literal.value)
  );
}

export function findRawTypeofChecks(source, filename = "source.js") {
  const hits = [];
  walk(parseSource(source, filename), null, (node, parent) => {
    if (isBrowserCallback(node, parent)) return SKIP_SUBTREE;
    if (isRawTypeofTest(node)) hits.push(snippet(source, node));
  });
  return hits;
}

const RULE_SCOPES = Object.freeze({
  fallbackChain: isFirstPartyProductionPath,
  inlineTrim: (file) => !isTestFilePath(file),
  typeCheck: (file) => !isTestFilePath(file),
  rawTypeof: (file) => !isTestFilePath(file),
  textShadow: () => true,
});

const RULE_FINDERS = Object.freeze({
  fallbackChain: findFallbackChains,
  inlineTrim: (source, file) =>
    findInlineTrimFallbacks(source, file, { skipFieldChains: isFirstPartyProductionPath(file) }),
  typeCheck: findInlineTypeChecks,
  rawTypeof: findRawTypeofChecks,
  textShadow: findTextShadowing,
});

export function includesFile(rule, file) {
  return RULE_SCOPES[rule](file);
}

export function findRuleHits(rule, source, file, usage) {
  if (!usage.covers(rule, EXEMPTION_KINDS.PATH_PREFIX, file)) {
    return RULE_FINDERS[rule](source, file, usage);
  }
  if (RULE_FINDERS[rule](source, file, NO_EXEMPTIONS).length) {
    usage.exempts(rule, EXEMPTION_KINDS.PATH_PREFIX, file);
  }
  return [];
}

async function measureRules(usage) {
  const files = await getFirstPartyCodeFiles({
    repositoryRoot: root,
    extensions: [".js", ".mjs", ".cjs", ".jsx", ".vue"],
    includeTests: true,
  });
  const names = Object.keys(CHECK.rules);
  const measured = Object.fromEntries(names.map((name) => [name, emptyMeasurement()]));
  for (const relativePath of files) {
    const file = relativePath.replaceAll("\\", "/");
    const included = names.filter((name) => includesFile(name, file));
    if (!included.length) continue;
    const source = await readFile(path.join(root, relativePath), "utf8");
    for (const name of included) {
      for (const { line, code } of findRuleHits(name, source, file, usage)) {
        addHit(measured[name], { file, line, message: code });
      }
    }
  }
  return measured;
}

await runCheckWhenMain(CHECK, import.meta.url);
