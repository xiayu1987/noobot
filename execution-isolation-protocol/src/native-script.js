/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const NATIVE_SCRIPT_RESULT_FIELD = "script_result";

export const NATIVE_SCRIPT_CAPABILITY_BINDINGS = Object.freeze({
  browser: Object.freeze(["browser"]),
  document: Object.freeze(["libreoffice"]),
  media: Object.freeze(["ffmpeg", "ffprobe"]),
});

export const NATIVE_SCRIPT_BROWSER_PAGE_METHODS = Object.freeze([
  "goto",
  "reload",
  "goBack",
  "goForward",
  "title",
  "url",
  "content",
  "setContent",
  "textContent",
  "click",
  "fill",
  "press",
  "waitForSelector",
  "waitForLoadState",
  "waitForTimeout",
  "locator",
  "screenshot",
  "close",
]);

export const NATIVE_SCRIPT_BROWSER_LOCATOR_METHODS = Object.freeze([
  "click",
  "dblclick",
  "fill",
  "press",
  "check",
  "uncheck",
  "selectOption",
  "hover",
  "focus",
  "count",
  "isVisible",
  "textContent",
  "innerText",
  "getAttribute",
  "waitFor",
  "setInputFiles",
  "screenshot",
]);

export const NATIVE_SCRIPT_FORBIDDEN_SYNTAX = Object.freeze([
  "ImportDeclaration",
  "ImportExpression",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "MetaProperty",
  "ThisExpression",
]);

export const NATIVE_SCRIPT_FORBIDDEN_IDENTIFIERS = Object.freeze([
  "require",
  "process",
  "globalThis",
  "global",
  "eval",
  "Function",
  "WebAssembly",
  "Buffer",
  "fetch",
  "module",
  "Reflect",
  "Proxy",
  "constructor",
  "prototype",
  "__proto__",
]);

export const NATIVE_SCRIPT_FORBIDDEN_PROPERTIES = Object.freeze([
  "constructor",
  "__proto__",
  "prototype",
]);

export const NATIVE_SCRIPT_SOURCE_POLICY = Object.freeze({
  forbiddenSyntax: NATIVE_SCRIPT_FORBIDDEN_SYNTAX,
  forbiddenIdentifiers: NATIVE_SCRIPT_FORBIDDEN_IDENTIFIERS,
  forbiddenProperties: NATIVE_SCRIPT_FORBIDDEN_PROPERTIES,
  dynamicComputedPropertyAccess: false,
});
