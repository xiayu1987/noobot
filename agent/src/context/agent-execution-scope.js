/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { assertValidAgentContextEnvelope } from "@noobot/context-protocol/agent-context/validation";
import { assertMainFlowControlPort } from "@noobot/context-protocol/policy/main-flow-control";
import { isPlainObject } from "@noobot/shared/value";

export function createAgentExecutionScope({ context, bindings }) {
  assertValidAgentContextEnvelope(context);
  if (!isPlainObject(bindings.runtime)) {
    throw new TypeError("agent execution scope bindings.runtime is required");
  }
  assertMainFlowControlPort(bindings.mainFlowControl);
  if (!Array.isArray(bindings.tools)) {
    throw new TypeError("agent execution scope bindings.tools must be an array");
  }
  if (!isPlainObject(bindings.extensions)) {
    throw new TypeError("agent execution scope bindings.extensions must be a plain object");
  }
  return { context, bindings };
}

export function getAgentContextEnvelope(scope) {
  if (!isPlainObject(scope) || !isPlainObject(scope.context)) {
    throw new TypeError("agent execution scope context is required");
  }
  return scope.context;
}
