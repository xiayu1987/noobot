/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parse as parseJavaScript } from "espree";
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import { readRepositoryText, repositoryRoot } from "./quality/repository-files.mjs";
import { isBrowserCallback } from "./quality/browser-callbacks.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const BROWSER_TEST_ROOTS = Object.freeze(["client/noobot-chat/tests/e2e"]);

function childNodes(node) {
  const children = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item && typeof item.type === "string") children.push(item);
    }
  }
  return children;
}

function* walk(node, parent = null) {
  yield { node, parent };
  for (const child of childNodes(node)) yield* walk(child, node);
}

function isReference(node, parent) {
  if (!parent) return true;
  if (parent.type === "MemberExpression") return parent.object === node || parent.computed;
  if (parent.type === "Property") return parent.value === node || parent.computed;
  if (parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") {
    return parent.computed && parent.key === node;
  }
  return !["LabeledStatement", "BreakStatement", "ContinueStatement"].includes(parent.type);
}

function collectPatternNames(pattern, names) {
  for (const { node, parent } of walk(pattern)) {
    if (node.type === "Identifier" && isReference(node, parent)) names.add(node.name);
  }
}

function declaredNames(callback) {
  const names = new Set();
  for (const param of callback.params) collectPatternNames(param, names);
  for (const { node } of walk(callback.body)) {
    if (node.type === "VariableDeclarator") collectPatternNames(node.id, names);
    if (/Function/.test(node.type)) {
      if (node.id) names.add(node.id.name);
      for (const param of node.params) collectPatternNames(param, names);
    }
    if (node.type === "CatchClause" && node.param) collectPatternNames(node.param, names);
  }
  return names;
}

function importedNames(program) {
  const names = new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) names.add(specifier.local.name);
  }
  return names;
}

function browserCallbacks(program) {
  const callbacks = [];
  for (const { node, parent } of walk(program)) {
    if (isBrowserCallback(node, parent)) {
      callbacks.push({ method: parent.callee.property.name, callback: node });
    }
  }
  return callbacks;
}

export function findBrowserCallbackModuleBindings(source) {
  const program = parseJavaScript(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    loc: true,
  });
  const imported = importedNames(program);
  const hits = [];
  for (const { method, callback } of browserCallbacks(program)) {
    const local = declaredNames(callback);
    for (const { node, parent } of walk(callback.body, callback)) {
      if (node.type !== "Identifier" || !imported.has(node.name) || local.has(node.name)) continue;
      if (isReference(node, parent))
        hits.push({ method, name: node.name, line: node.loc.start.line });
    }
  }
  return hits;
}

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  const files = await getFirstPartyFilesUnder(BROWSER_TEST_ROOTS, {
    repositoryRoot,
    extensions: [".js", ".mjs"],
    includeTests: true,
  });
  for (const file of files) {
    for (const hit of findBrowserCallbackModuleBindings(await readRepositoryText(file))) {
      addHit(measured.browserCallbackModuleBinding, {
        file,
        line: hit.line,
        message: `${hit.method} callback references module binding '${hit.name}'`,
      });
    }
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "browser-callback-bindings",
  description: "Browser-executed Playwright callbacks never reference module bindings",
  rules: {
    browserCallbackModuleBinding: {
      description:
        "evaluate/addInitScript/waitForFunction callbacks only use browser globals and arguments",
      hint: "use browser-native code inside the callback or pass values as callback arguments",
    },
  },
  exemptions: [],
  baseline: { browserCallbackModuleBinding: 0, exemptions: 0 },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
