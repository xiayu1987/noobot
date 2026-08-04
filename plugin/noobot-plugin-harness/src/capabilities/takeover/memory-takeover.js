/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";
import { isMessageInjected } from "./shared.js";
import {
  appendMessage,
  resolveModelMessageBlocks,
  writeMessageBlocks,
} from "../../core/message-store.js";

function normalizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || "").trim()).filter(Boolean);
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

  if (takeover?.clearAttachments === true && Array.isArray(payload?.attachments)) {
    payload.attachments = [];
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

function applyMemoryTakeoverForModelContext(ctx = {}, takeover = {}) {
  if (!ctx || typeof ctx !== "object") return false;
  let changed = false;
  const blocks = resolveModelMessageBlocks(ctx);
  const history = blocks.history;
  if (takeover?.clearHistory === true && history.length) {
    writeMessageBlocks(ctx, { ...blocks, history: [] });
    changed = true;
  } else {
    const trimTo = Number(takeover?.trimHistoryTo);
    if (Number.isFinite(trimTo) && trimTo >= 0 && history.length > trimTo) {
      writeMessageBlocks(ctx, { ...blocks, history: history.slice(history.length - trimTo) });
      changed = true;
    }
  }

  const memoryNote = String(takeover?.memoryNote || takeover?.injectSystemNote || "").trim();
  if (memoryNote) {
    const marker = String(takeover?.id || "harness-memory-takeover").trim();
    const content = `<!-- ${marker} -->\n${memoryNote}`;
    if (!isMessageInjected(resolveModelMessageBlocks(ctx).system, marker, content)) {
      appendMessage(ctx, { role: "system", content }, { block: "system" });
      changed = true;
    }
  }

  return changed;
}

export function applyMemoryTakeover(point = "", ctx = {}, takeover = {}) {
  if (!takeover || typeof takeover !== "object") return false;
  if (takeover.enabled === false) return false;
  let changed = false;
  if (point === HOOK_POINT.AGENT.BEFORE_STATE_COMMIT) {
    changed = applyMemoryTakeoverForStateCommit(ctx, takeover) || changed;
  }
  changed = applyMemoryTakeoverForModelContext(ctx, takeover) || changed;
  return changed;
}
