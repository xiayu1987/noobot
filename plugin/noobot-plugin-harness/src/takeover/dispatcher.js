/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { safeError } from "../data/record-builders.js";
import { toolTakeoverHandler } from "./tool-takeover.js";
import { messageTakeoverHandler } from "./message-takeover.js";
import { memoryTakeoverHandler } from "./memory-takeover.js";

const takeoverHandlers = new Map();

export function registerTakeover(type, handler) {
  takeoverHandlers.set(String(type).toLowerCase(), handler);
}

export async function applyTakeover(type, ctx, directive, options = {}) {
  const handler = takeoverHandlers.get(String(type).toLowerCase());
  if (!handler) return { applied: false, reason: `No handler for takeover type: ${type}` };
  try {
    return await handler(ctx, directive, options);
  } catch (err) {
    return { applied: false, error: safeError(err) };
  }
}

registerTakeover("tool", toolTakeoverHandler);
registerTakeover("message", messageTakeoverHandler);
registerTakeover("memory", memoryTakeoverHandler);
