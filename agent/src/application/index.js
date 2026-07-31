/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const AGENT_CLIENT_KIND = Object.freeze({
  SERVICE: "service",
  CLI: "cli",
  API: "api",
  IDE: "ide",
});

export const AGENT_APPLICATION_EVENT = Object.freeze({
  RUNTIME: "runtime",
  INTERACTION_REQUESTED: "interaction.requested",
  COMPLETED: "completed",
  FAILED: "failed",
});

function requireMethod(target, methodName) {
  const method = target?.[methodName];
  if (typeof method !== "function") {
    throw new TypeError(`Agent Application requires runtime.${methodName}()`);
  }
  return method.bind(target);
}

/**
 * Transport-neutral application boundary for Agent clients.
 * Service, a future CLI, IDE integrations, and tests must depend on this API
 * instead of BotManager internals. Plugin loading remains owned by Agent and
 * always uses the agent runtime surface.
 */
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
