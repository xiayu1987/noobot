/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";
import { replaceMessageProjection } from "./message-store.js";
import { resolveAuthoritativeModelMessages } from "@noobot/context-protocol/assembly/hook-context";

export function applyAgentResolvedModelMessages(point, ctx, options) {
  if (point !== HOOK_POINT.AGENT.BEFORE_LLM_CALL) return false;
  const resolved = resolveAuthoritativeModelMessages({
    ctx,
    resolver: options.resolveModelMessages,
    purpose: "main_agent",
  });
  replaceMessageProjection(ctx, resolved);
  return true;
}
