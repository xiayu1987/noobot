/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";
import { replaceMessageProjection } from "./message-store.js";
import { resolveAuthoritativeModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { text } from "@noobot/shared/value";

export function applyAgentResolvedModelMessages(point = "", ctx = {}, options = {}) {
  if (text(point).toLowerCase() !== HOOK_POINT.AGENT.BEFORE_LLM_CALL) return false;
  const modelContext = resolveAuthoritativeModelContext(ctx);
  if (!modelContext || !Array.isArray(modelContext.messages)) return false;
  const resolver = options.resolveModelMessages;
  if (typeof resolver !== "function") return false;
  const resolved = resolver({ ctx, messages: [], purpose: "main_agent" });
  if (!Array.isArray(resolved)) return false;
  replaceMessageProjection(ctx, resolved);
  return true;
}
