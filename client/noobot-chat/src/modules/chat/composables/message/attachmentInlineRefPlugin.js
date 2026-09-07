/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ATTACHMENT_IDENTITY_REF_PREFIX,
  attachmentIdentityKey,
  parseAttachmentIdentityRef,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol/identity";

const ATTACHMENT_INLINE_TOKEN = "noobot_attachment_ref";
const REF_TERMINATOR_RE = /[\s<>"'`)\]}]/;

function escapeHtmlAttribute(value = "") {
  return String(value || "")
  .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function trimTrailingPunctuation(candidate = "") {
  return String(candidate || "").replace(/[.,;:!?]+$/, "");
}

function readRefAtPosition(src = "", start = 0) {
  if (!src.startsWith(ATTACHMENT_IDENTITY_REF_PREFIX, start)) return "";
  let cursor = start + ATTACHMENT_IDENTITY_REF_PREFIX.length;
  while (cursor < src.length && !REF_TERMINATOR_RE.test(src[cursor])) cursor += 1;
  return trimTrailingPunctuation(src.slice(start, cursor));
}

function resolveIdentity(ref = "") {
  try {
    return parseAttachmentIdentityRef(ref);
  } catch {
    return null;
  }
}

/**
 * 把权威附件集合投影为按 identity key 索引的查表结构。
 * 索引只用于查表，href 一律取自调用方提供的 resolveHref，禁止拼接式猜测。
 */
export function buildAttachmentRefIndex(attachmentItems = [], { resolveHref } = {}) {
  const index = new Map();
  if (typeof resolveHref !== "function") return index;
  for (const attachmentItem of Array.isArray(attachmentItems) ? attachmentItems : []) {
    let key = "";
    try {
      key = attachmentIdentityKey(projectAttachmentIdentity(attachmentItem));
    } catch {
      continue;
    }
    const href = String(resolveHref(attachmentItem) || "").trim();
    if (!href) continue;
  index.set(key, {
      href,
      name: String(attachmentItem?.name || attachmentItem?.fileName || "").trim(),
    });
  }
  return index;
}

function lookupAttachment(env, identity) {
  const index = env?.attachmentRefIndex;
  if (!(index instanceof Map)) return null;
  return index.get(attachmentIdentityKey(identity)) || null;
}

function renderResolvedChip({ href, label }) {
  return [
    `<a class="noobot-attachment-chip" href="${escapeHtmlAttribute(href)}"`,
    ` download title="${escapeHtmlAttribute(label)}">`,
    `<span class="noobot-attachment-chip__icon" aria-hidden="true">📎</span>`,
    `<span class="noobot-attachment-chip__name">${escapeHtmlAttribute(label)}</span>`,
    "</a>",
  ].join("");
}

function renderMissingChip({ label, reason }) {
  return [
    `<span class="noobot-attachment-chip noobot-attachment-chip--missing"`,
    ` data-attachment-missing-reason="${escapeHtmlAttribute(reason)}"`,
    ` title="${escapeHtmlAttribute(reason)}">`,
    `<span class="noobot-attachment-chip__icon" aria-hidden="true">📎</span>`,
  `<span class="noobot-attachment-chip__name">${escapeHtmlAttribute(label)}</span>`,
    "</span>",
  ].join("");
}

/**
 * markdown-it 的 text 规则会把不含特殊字符的整段文本一次吞掉，裸 ref 无法靠
 * inline 规则命中，因此在 core 阶段拆分 text token（与 linkify 同层）。
 */
function splitTextTokenByRef(state, textToken) {
  const src = String(textToken.content || "");
  const produced = [];
  let cursor = 0;
  let plainStart = 0;

  const flushPlain = (end) => {
    if (end <= plainStart) return;
    const plainToken = new state.Token("text", "", 0);
    plainToken.content = src.slice(plainStart, end);
    produced.push(plainToken);
  };

  while (cursor < src.length) {
    const hit = src.indexOf(ATTACHMENT_IDENTITY_REF_PREFIX, cursor);
    if (hit < 0) break;
    const ref = readRefAtPosition(src, hit);
    const identity = ref ? resolveIdentity(ref) : null;
    if (!identity) {
      cursor = hit + ATTACHMENT_IDENTITY_REF_PREFIX.length;
      continue;
    }
    flushPlain(hit);
    const refToken = new state.Token(ATTACHMENT_INLINE_TOKEN, "", 0);
    refToken.meta = { ref, identity, label: "" };
    produced.push(refToken);
    cursor = hit + ref.length;
    plainStart = cursor;
  }

  if (!produced.length) return null;
  flushPlain(src.length);
  return produced;
}

function rewriteAttachmentTextTokens(state) {
  for (const blockToken of state.tokens || []) {
    if (blockToken.type !== "inline" || !Array.isArray(blockToken.children)) continue;
    const children = blockToken.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (children[index]?.type !== "text") continue;
      const produced = splitTextTokenByRef(state, children[index]);
      if (produced) children.splice(index, 1, ...produced);
    }
  }
}

/**
 * markdown-it 的 validateLink 会放行 attachment: scheme，产出看似可点实则无效的
 * 真实 <a>。这里把这类 link token 一并接管，避免出现假链接。
 */
function rewriteAttachmentLinkTokens(state) {
  for (const blockToken of state.tokens || []) {
    if (blockToken.type !== "inline" || !Array.isArray(blockToken.children)) continue;
    const children = blockToken.children;
    for (let index = 0; index < children.length; index += 1) {
      const token = children[index];
      if (token.type !== "link_open") continue;
      const href = String(token.attrGet?.("href") || "");
   if (!href.startsWith(ATTACHMENT_IDENTITY_REF_PREFIX)) continue;
      const identity = resolveIdentity(href);
      if (!identity) continue;

      let closeIndex = index + 1;
      let depth = 1;
      const labelParts = [];
      while (closeIndex < children.length && depth > 0) {
        const cursorToken = children[closeIndex];
        if (cursorToken.type === "link_open") depth += 1;
        else if (cursorToken.type === "link_close") {
          depth -= 1;
          if (depth === 0) break;
        } else if (typeof cursorToken.content === "string") {
          labelParts.push(cursorToken.content);
   }
      closeIndex += 1;
   }
      if (depth !== 0) continue;

      const replacement = new state.Token(ATTACHMENT_INLINE_TOKEN, "", 0);
      replacement.meta = { ref: href, identity, label: labelParts.join("").trim() };
      children.splice(index, closeIndex - index + 1, replacement);
    }
  }
}

function renderAttachmentToken(tokens, idx, options, env) {
  const meta = tokens[idx]?.meta || {};
  const { identity, ref, label } = meta;
  if (!identity) return escapeHtmlAttribute(ref || "");

  const matched = lookupAttachment(env, identity);
  if (!matched) {
    return renderMissingChip({
 label: label || identity.attachmentId,
      reason: "attachment_not_available",
    });
  }
  return renderResolvedChip({
    href: matched.href,
    label: label || matched.name || identity.attachmentId,
  });
}

export function attachmentInlineRefPlugin(md) {
  md.core.ruler.push(`${ATTACHMENT_INLINE_TOKEN}_links`, rewriteAttachmentLinkTokens);
  md.core.ruler.push(`${ATTACHMENT_INLINE_TOKEN}_text`, rewriteAttachmentTextTokens);
  md.renderer.rules[ATTACHMENT_INLINE_TOKEN] = renderAttachmentToken;
}

export { ATTACHMENT_INLINE_TOKEN };
