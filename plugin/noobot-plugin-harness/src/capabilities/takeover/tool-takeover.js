/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizeToolNameSet(input) {
  if (!Array.isArray(input)) return new Set();
  return new Set(
    input
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
}

function normalizeCallShape(call = null) {
  if (!call || typeof call !== "object") return null;
  const name = String(call?.name || "").trim();
  if (!name) return null;
  return {
    ...call,
    name,
    args:
      call?.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? call.args
        : {},
  };
}

function applyTakeoverForBeforeToolCalls(ctx = {}, takeover = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  if (!Array.isArray(ctx.calls)) return false;

  const calls = ctx.calls;
  let changed = false;

  const allowSet = normalizeToolNameSet(takeover?.allowToolNames || takeover?.allowTools);
  const denySet = normalizeToolNameSet(takeover?.denyToolNames || takeover?.denyTools);
  if (allowSet.size || denySet.size) {
    const nextCalls = calls.filter((call) => {
      const toolName = String(call?.name || "").trim();
      if (!toolName) return false;
      if (allowSet.size && !allowSet.has(toolName)) return false;
      if (denySet.size && denySet.has(toolName)) return false;
      return true;
    });
    if (nextCalls.length !== calls.length) {
      calls.splice(0, calls.length, ...nextCalls);
      changed = true;
    }
  }

  const forcedCall = normalizeCallShape(takeover?.forceCall || takeover?.overrideCall);
  if (forcedCall) {
    const shouldReplace = takeover?.mode === "replace" || takeover?.replace === true;
    if (shouldReplace) {
      calls.splice(0, calls.length, forcedCall);
    } else {
      calls.unshift(forcedCall);
    }
    changed = true;
  }

  const maxCalls = Number(takeover?.maxCalls);
  if (Number.isFinite(maxCalls) && maxCalls >= 0 && calls.length > maxCalls) {
    calls.splice(maxCalls);
    changed = true;
  }

  if (takeover?.cancelAll === true && calls.length) {
    calls.splice(0, calls.length);
    changed = true;
  }

  return changed;
}

function applyTakeoverForBeforeToolCall(ctx = {}, takeover = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  if (!ctx.call || typeof ctx.call !== "object") return false;

  const overrideCall = normalizeCallShape(takeover?.overrideCall || takeover?.forceCall);
  if (!overrideCall) return false;

  ctx.call.name = overrideCall.name;
  ctx.call.args = overrideCall.args || {};
  if (overrideCall.id) ctx.call.id = overrideCall.id;
  return true;
}

export function applyToolTakeover(point = "", ctx = {}, takeover = {}) {
  if (!takeover || typeof takeover !== "object") return false;
  if (takeover.enabled === false) return false;
  if (point === "before_tool_calls") {
    return applyTakeoverForBeforeToolCalls(ctx, takeover);
  }
  if (point === "before_tool_call") {
    return applyTakeoverForBeforeToolCall(ctx, takeover);
  }
  return false;
}
