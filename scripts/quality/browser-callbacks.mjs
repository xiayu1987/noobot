/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const BROWSER_CALLBACK_METHODS = new Set([
  "evaluate",
  "evaluateAll",
  "evaluateHandle",
  "addInitScript",
  "waitForFunction",
  "$eval",
  "$$eval",
]);

const FUNCTION_EXPRESSION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

export function isBrowserCallbackCall(node) {
  if (node?.type !== "CallExpression") return false;
  const callee = node.callee;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    BROWSER_CALLBACK_METHODS.has(callee.property.name)
  );
}

export function isBrowserCallback(node, parent) {
  return (
    FUNCTION_EXPRESSION_TYPES.has(node?.type) &&
    isBrowserCallbackCall(parent) &&
    parent.arguments.includes(node)
  );
}
