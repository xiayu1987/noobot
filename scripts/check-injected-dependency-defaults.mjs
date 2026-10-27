/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  addHit,
  defineCheck,
  emptyMeasurement,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { parseSource, snippet, walk } from "./quality/source-ast.mjs";
import { getFirstPartyCodeFiles, isTestFilePath } from "./quality/source-inventory.mjs";

const root = path.resolve(import.meta.dirname, "..");
const CLIENT_SOURCE_PREFIX = "client/noobot-chat/src/";
const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const FETCHER_NAME = /fetch(er)?$/i;

function isEmptyObject(node) {
  return node?.type === "ObjectExpression" && node.properties.length === 0;
}

function isEmptyDependencyBag(param) {
  return (
    param.type === "AssignmentPattern" &&
    param.left.type === "ObjectPattern" &&
    isEmptyObject(param.right)
  );
}

export function findEmptyDependencyBags(source, filename = "source.js") {
  const hits = [];
  walk(parseSource(source, filename), null, (node) => {
    if (!FUNCTION_TYPES.has(node.type)) return;
    for (const param of node.params) {
      if (isEmptyDependencyBag(param)) hits.push(snippet(source, param));
    }
  });
  return hits;
}

export function findOptionalDependencyCalls(source, filename = "source.js") {
  const hits = [];
  walk(parseSource(source, filename), null, (node) => {
    if (node.type === "CallExpression" && node.optional && node.callee.type === "Identifier") {
      hits.push(snippet(source, node));
    }
  });
  return hits;
}

export function findFetcherFallbacks(source, filename = "source.js") {
  const hits = [];
  walk(parseSource(source, filename), null, (node) => {
    const isFallback = node.type === "LogicalExpression" && ["||", "??"].includes(node.operator);
    if (isFallback && node.left.type === "Identifier" && FETCHER_NAME.test(node.left.name)) {
      hits.push(snippet(source, node));
    }
  });
  return hits;
}

const RULE_FINDERS = Object.freeze({
  emptyDependencyBag: findEmptyDependencyBags,
  optionalDependencyCall: findOptionalDependencyCalls,
  fetcherFallback: findFetcherFallbacks,
});

export function includesFile(file) {
  return file.startsWith(CLIENT_SOURCE_PREFIX) && !isTestFilePath(file);
}

async function measure() {
  const files = await getFirstPartyCodeFiles({
    repositoryRoot: root,
    extensions: [".js", ".mjs", ".vue"],
  });
  const measurements = Object.fromEntries(
    Object.keys(RULE_FINDERS).map((rule) => [rule, emptyMeasurement()]),
  );
  for (const file of files.map((item) => path.relative(root, item)).filter(includesFile)) {
    const source = await readFile(path.join(root, file), "utf8");
    for (const [rule, find] of Object.entries(RULE_FINDERS)) {
      for (const { line, code } of find(source, file)) {
        addHit(measurements[rule], { file, line, message: code });
      }
    }
  }
  return measurements;
}

export const CHECK = defineCheck({
  id: "injected-dependency-defaults",
  description: "client parameters and calls that make dependencies or options silently optional",
  rules: {
    emptyDependencyBag: {
      description: "({ ... } = {}) parameters, for dependency bags and option bags alike",
      hint: "require the bag at every caller; assert dependencies with requireFunctionDependencies",
    },
    optionalDependencyCall: {
      description: "name?.() calls on a bare identifier, injected or local",
      hint: "assert the callee where it is bound and call it directly",
    },
    fetcherFallback: {
      description: "fetcher || fallback expressions that silently swap the request channel",
      hint: "require the authenticated fetcher from the connection layer",
    },
  },
  exemptions: [],
  baseline: {
    emptyDependencyBag: 103,
    optionalDependencyCall: 14,
    fetcherFallback: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
