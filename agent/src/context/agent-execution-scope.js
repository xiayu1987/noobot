/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { assertValidAgentContextEnvelope } from "@noobot/context-protocol/agent-context-validation";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function createAgentExecutionScope({ context, bindings = {} } = {}) {
  assertValidAgentContextEnvelope(context);
  const runtime = asObject(bindings?.runtime);
  if (!runtime) throw new TypeError("agent execution scope bindings.runtime is required");
  const tools = Array.isArray(bindings?.tools) ? bindings.tools : [];
  const extensions = asObject(bindings?.extensions) || {};
  return {
    context,
    bindings: {
      ...bindings,
      runtime,
      tools,
      extensions,
    },
  };
}

export function getAgentContextEnvelope(scope = {}) {
  const context = asObject(scope?.context);
  if (!context) throw new TypeError("agent execution scope context is required");
  return context;
}
