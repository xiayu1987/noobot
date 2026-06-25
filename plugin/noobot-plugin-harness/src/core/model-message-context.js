/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { replaceMessages } from "./message-store.js";

export function applyAgentResolvedModelMessages(point = "", ctx = {}, options = {}) {
  if (String(point || "").trim().toLowerCase() !== "before_llm_call") return false;
  if (!ctx || typeof ctx !== "object" || !Array.isArray(ctx.messages)) return false;
  const resolver = options?.resolveModelMessages || options?.harness?.resolveModelMessages;
  if (typeof resolver !== "function") return false;
  let resolved = null;
  try {
    resolved = resolver({ ctx, messages: [], purpose: "main_agent" });
  } catch {
    return false;
  }
  if (!Array.isArray(resolved)) return false;
  replaceMessages(ctx, resolved);
  return true;
}
