/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function ensureMessageArray(ctx = {}, target = "auto") {
  const arrays = [];
  if ((target === "auto" || target === "ctx_messages") && Array.isArray(ctx?.messages)) {
    arrays.push(ctx.messages);
  }
  if (
    (target === "auto" || target === "agent_system") &&
    Array.isArray(ctx?.agentContext?.payload?.messages?.system)
  ) {
    arrays.push(ctx.agentContext.payload.messages.system);
  }
  return arrays;
}

function isMessageInjected(messages = [], id = "", content = "") {
  if (!Array.isArray(messages) || !messages.length) return false;
  if (id) {
    return messages.some((msg) => String(msg?.content || "").includes(`<!-- ${id} -->`));
  }
  return messages.some((msg) => String(msg?.content || "") === content);
}

function resolveInternalMessageType(message = {}) {
  return String(
    message?.additional_kwargs?.noobotInternalMessageType ||
      message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      message?.metadata?.noobotInternalMessageType ||
      message?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "",
  ).trim();
}

function removeInternalForcedMessages(messages = [], directive = {}) {
  if (!Array.isArray(messages)) return 0;
  const removeAll = directive?.cancelInternalForcedMessages === true;
  const removeTypesInput =
    directive?.removeInternalMessageTypes ||
    directive?.stripInternalMessageTypes ||
    directive?.blockInternalMessageTypes ||
    [];
  const removeTypes = Array.isArray(removeTypesInput)
    ? new Set(removeTypesInput.map((item) => String(item || "").trim()).filter(Boolean))
    : new Set();
  if (!removeAll && !removeTypes.size) return 0;

  let removed = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const marker = resolveInternalMessageType(messages[index]);
    if (!marker) continue;
    if (removeAll || removeTypes.has(marker)) {
      messages.splice(index, 1);
      removed += 1;
    }
  }
  return removed;
}

function applyMessageArrayTakeover(messages = [], directive = {}) {
  if (!Array.isArray(messages)) return false;
  const removed = removeInternalForcedMessages(messages, directive);
  const content = String(
    directive?.content ?? directive?.text ?? directive?.message ?? "",
  ).trim();
  if (!content) return removed > 0;
  const id = String(directive?.id || "").trim();
  const mode = String(directive?.mode || "prepend").trim();
  const dedupe = directive?.dedupe !== false;
  const messageContent = id ? `<!-- ${id} -->\n${content}` : content;
  if (dedupe && isMessageInjected(messages, id, messageContent)) return false;

  const nextMessage = {
    role: String(directive?.role || "system").trim() || "system",
    content: messageContent,
  };

  if (mode === "replace") {
    messages.splice(0, messages.length, nextMessage);
    return true;
  }
  if (mode === "append") {
    messages.push(nextMessage);
    return true;
  }
  messages.unshift(nextMessage);
  return true;
}

export function applyMessageTakeover(_point = "", ctx = {}, takeover = {}) {
  if (!takeover || typeof takeover !== "object") return false;
  if (takeover.enabled === false) return false;
  const target = String(takeover?.target || "auto").trim();
  const messageArrays = ensureMessageArray(ctx, target);
  if (!messageArrays.length) return false;
  let changed = false;
  for (const messages of messageArrays) {
    changed = applyMessageArrayTakeover(messages, takeover) || changed;
  }
  return changed;
}
