/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function requireMethod(target, methodName) {
  const method = target?.[methodName];
  if (typeof method !== "function") {
    throw new TypeError(`Agent Application requires runtime.${methodName}()`);
  }
  return method.bind(target);
}

export function createAgentApplication({ runtime } = {}) {
  const runSession = requireMethod(runtime, "runSession");
  const resolveExecutionIntent = requireMethod(runtime, "resolveExecutionIntent");

  return Object.freeze({
    async run(input = {}) {
      return runSession(input);
    },
    async resolveExecutionIntent(input = {}) {
      return resolveExecutionIntent(input);
    },
  });
}
