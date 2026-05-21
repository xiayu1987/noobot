/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || "").trim()).filter(Boolean);
}

function isMessageInjected(messages = [], id = "", content = "") {
  if (!Array.isArray(messages) || !messages.length) return false;
  if (id) {
    return messages.some((msg) => String(msg?.content || "").includes(`<!-- ${id} -->`));
  }
  return messages.some((msg) => String(msg?.content || "") === content);
}

function applyMemoryTakeoverForStateCommit(ctx = {}, takeover = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  if (!ctx.payload || typeof ctx.payload !== "object") return false;
  const commitType = String(ctx?.commitType || "").trim();
  const allowCommitTypes = normalizeStringArray(takeover?.allowCommitTypes);
  const blockCommitTypes = normalizeStringArray(takeover?.blockCommitTypes);
  if (allowCommitTypes.length && !allowCommitTypes.includes(commitType)) return false;
  if (blockCommitTypes.length && blockCommitTypes.includes(commitType)) return false;

  let changed = false;
  const payload = ctx.payload;

  const overridePayload =
    takeover?.overridePayload &&
    typeof takeover.overridePayload === "object" &&
    !Array.isArray(takeover.overridePayload)
      ? takeover.overridePayload
      : null;
  if (overridePayload) {
    Object.assign(payload, overridePayload);
    changed = true;
  }

  const stripKeys = normalizeStringArray(takeover?.stripPayloadKeys || takeover?.redactPayloadKeys);
  if (stripKeys.length) {
    for (const key of stripKeys) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        delete payload[key];
        changed = true;
      }
    }
  }

  if (takeover?.clearToolCalls === true && Array.isArray(payload?.tool_calls)) {
    payload.tool_calls = [];
    changed = true;
  }

  if (takeover?.clearAttachmentMetas === true && Array.isArray(payload?.attachmentMetas)) {
    payload.attachmentMetas = [];
    changed = true;
  }

  const replaceContent = takeover?.content ?? takeover?.replaceContent;
  if (replaceContent !== undefined && payload?.content !== undefined) {
    payload.content = String(replaceContent || "");
    changed = true;
  } else if (typeof payload?.content === "string") {
    const prepend = String(takeover?.prependContent || "").trim();
    const append = String(takeover?.appendContent || "").trim();
    if (prepend) {
      payload.content = `${prepend}${payload.content}`;
      changed = true;
    }
    if (append) {
      payload.content = `${payload.content}${append}`;
      changed = true;
    }
  }

  return changed;
}

function applyMemoryTakeoverForAgentContext(ctx = {}, takeover = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  const agentContext =
    ctx?.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return false;

  let changed = false;
  const history = agentContext?.payload?.messages?.history;
  if (Array.isArray(history)) {
    if (takeover?.clearHistory === true && history.length) {
      history.splice(0, history.length);
      changed = true;
    }
    const trimTo = Number(takeover?.trimHistoryTo);
    if (Number.isFinite(trimTo) && trimTo >= 0 && history.length > trimTo) {
      history.splice(0, history.length - trimTo);
      changed = true;
    }
  }

  const memoryNote = String(takeover?.memoryNote || takeover?.injectSystemNote || "").trim();
  if (memoryNote && Array.isArray(agentContext?.payload?.messages?.system)) {
    const marker = String(takeover?.id || "harness-memory-takeover").trim();
    const content = `<!-- ${marker} -->\n${memoryNote}`;
    if (!isMessageInjected(agentContext.payload.messages.system, marker, content)) {
      agentContext.payload.messages.system.unshift({ role: "system", content });
      changed = true;
    }
  }

  return changed;
}

export function applyMemoryTakeover(point = "", ctx = {}, takeover = {}) {
  if (!takeover || typeof takeover !== "object") return false;
  if (takeover.enabled === false) return false;
  let changed = false;
  if (point === "before_state_commit") {
    changed = applyMemoryTakeoverForStateCommit(ctx, takeover) || changed;
  }
  changed = applyMemoryTakeoverForAgentContext(ctx, takeover) || changed;
  return changed;
}
