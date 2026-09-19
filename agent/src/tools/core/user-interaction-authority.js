/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
  getSystemRuntimeFromRuntime,
} from "../../context/agent-context-accessor.js";
import { createInteractionAuthority, validateInteractionAuthority } from "@noobot/event-protocol";

export function resolveUserInteractionAuthority(agentContext = {}) {
  const identity = getSessionIdsFromAgentContext(agentContext);
  const runtime = getRuntimeFromAgentContext(agentContext);
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const authority = createInteractionAuthority({
    session: identity,
    turn: identity,
    persistenceScope: systemRuntime.persistenceScope || null,
  });
  const validation = validateInteractionAuthority(authority);
  if (!validation.valid) {
    throw new TypeError(
      `invalid user interaction AgentContext authority: ${validation.errors.join(",")}`,
    );
  }
  return authority;
}
