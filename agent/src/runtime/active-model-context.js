/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_CONTEXT_PROTOCOL_VERSION } from "@noobot/context-protocol/agent-context/schema";

function assertRuntime(runtime) {
  if (runtime === null || typeof runtime !== "object") {
    throw new TypeError("active model context requires a runtime object");
  }
}

export function readActiveModelContext(runtime) {
  assertRuntime(runtime);
  const modelContext = runtime.activeMessageContext;
  if (modelContext === null) return null;
  if (modelContext?.protocolVersion !== MODEL_CONTEXT_PROTOCOL_VERSION) {
    throw new TypeError(
      `runtime.activeMessageContext must be null or modelContext protocolVersion=${MODEL_CONTEXT_PROTOCOL_VERSION}`,
    );
  }
  return modelContext;
}

export function requireActiveModelContext(runtime) {
  const modelContext = readActiveModelContext(runtime);
  if (modelContext === null) {
    throw new TypeError("runtime.activeMessageContext is required after agent state is built");
  }
  return modelContext;
}
