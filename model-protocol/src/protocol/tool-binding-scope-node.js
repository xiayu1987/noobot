/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";

const toolNameBindingScope = new AsyncLocalStorage();

export function runWithToolNameBinding(binding, operation) {
  return toolNameBindingScope.run(binding, operation);
}

export function getToolNameBinding() {
  return toolNameBindingScope.getStore();
}

export function requireToolNameBinding() {
  const binding = getToolNameBinding();
  if (!binding) throw new TypeError("tool name binding scope is required");
  return binding;
}
