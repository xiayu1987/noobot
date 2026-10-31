/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ATTACHMENT_IDENTITY_REF_PREFIX,
  attachmentIdentityKey,
  formatAttachmentIdentityRef,
  parseAttachmentIdentityRef,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol/identity";
import {
  isFileLinkHref,
  mutationLinkRef,
  RESOURCE_LINK_STATUS,
  resolveLinkedResource,
} from "@noobot/path-resolver/resource-link";
import { text } from "@noobot/shared/value";

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

export function buildAttachmentRefIndex(attachmentItems = []) {
  const index = new Map();
  for (const attachmentItem of Array.isArray(attachmentItems) ? attachmentItems : []) {
    let identity;
    try {
      identity = projectAttachmentIdentity(attachmentItem);
    } catch {
      continue;
    }
    index.set(attachmentIdentityKey(identity), {
      ...identity,
      name: text(attachmentItem.name),
    });
  }
  return index;
}

function lookupAttachment(env, identity) {
  const index = env.attachmentRefIndex;
  if (index === null) return null;
  return index.get(attachmentIdentityKey(identity)) || null;
}

function supersededAttributes(superseded) {
  if (!superseded) return "";
  return ' data-noobot-link-superseded="true"';
}

function chipTitle(env, title, superseded) {
  return superseded ? `${title} · ${env.translate("message.fileLinkSuperseded")}` : title;
}

function renderResolvedChip(env, { ref, label, superseded }) {
  return [
    '<a class="noobot-attachment-chip" href="#" role="button"',
    ` data-noobot-attachment-ref="${escapeHtmlAttribute(ref)}"${supersededAttributes(superseded)}`,
    ` title="${escapeHtmlAttribute(chipTitle(env, label, superseded))}">`,
    `<span class="noobot-attachment-chip__icon" aria-hidden="true">📎</span>`,
    `<span class="noobot-attachment-chip__name">${escapeHtmlAttribute(label)}</span>`,
    "</a>",
  ].join("");
}

function renderMutationChip(env, { mutationRef, label, superseded }) {
  return [
    '<a class="noobot-attachment-chip" href="#" role="button"',
    ` data-noobot-mutation-ref="${escapeHtmlAttribute(mutationLinkRef(mutationRef))}"`,
    supersededAttributes(superseded),
    ` title="${escapeHtmlAttribute(chipTitle(env, mutationRef.fileName, superseded))}">`,
    `<span class="noobot-attachment-chip__icon" aria-hidden="true">📄</span>`,
    `<span class="noobot-attachment-chip__name">${escapeHtmlAttribute(label)}</span>`,
    "</a>",
  ].join("");
}

function renderMissingChip(env, { label, reason }) {
  return [
    `<span class="noobot-attachment-chip noobot-attachment-chip--missing"`,
    ` data-attachment-missing-reason="${escapeHtmlAttribute(reason)}"`,
    ` title="${escapeHtmlAttribute(env.translate(`message.fileLinkUnavailable.${reason}`))}">`,
    `<span class="noobot-attachment-chip__icon" aria-hidden="true">📎</span>`,
    `<span class="noobot-attachment-chip__name">${escapeHtmlAttribute(label)}</span>`,
    "</span>",
  ].join("");
}

function renderLatestChip(env, latest) {
  if (!latest) return "";
  if (latest.identity && !lookupAttachment(env, latest.identity)) return "";
  const dataAttribute = latest.mutationRef
    ? ` data-noobot-mutation-ref="${escapeHtmlAttribute(mutationLinkRef(latest.mutationRef))}"`
    : ` data-noobot-attachment-ref="${escapeHtmlAttribute(latest.ref)}"`;
  const label = env.translate("message.fileLinkLatest");
  return [
    '<a class="noobot-attachment-chip noobot-attachment-chip--latest" href="#" role="button"',
    dataAttribute,
    ` title="${escapeHtmlAttribute(label)}">`,
    `<span class="noobot-attachment-chip__icon" aria-hidden="true">↻</span>`,
    `<span class="noobot-attachment-chip__name">${escapeHtmlAttribute(label)}</span>`,
    "</a>",
  ].join("");
}

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

function downloadableTarget(linked) {
  if (linked.status === RESOURCE_LINK_STATUS.MUTATION) {
    return { mutationRef: linked.mutationRef, superseded: linked.superseded };
  }
  if (linked.status === RESOURCE_LINK_STATUS.ATTACHMENT) {
    return {
      ref: formatAttachmentIdentityRef(linked.identity),
      identity: linked.identity,
      superseded: linked.superseded,
    };
  }
  return null;
}

function resolveLinkTarget(href, env) {
  if (href.startsWith(ATTACHMENT_IDENTITY_REF_PREFIX)) {
    const identity = resolveIdentity(href);
    return identity ? { ref: href, identity, superseded: false } : null;
  }
  if (!isFileLinkHref(href)) return null;
  const linked = resolveLinkedResource(href, env.linkSnapshots, {
    messageIndex: env.messageIndex,
    workspaceRootDirectory: env.workspaceRootDirectory,
  });
  const latest = linked.latest ? downloadableTarget(linked.latest) : null;
  const target = downloadableTarget(linked) || { unavailableReason: linked.reason, href };
  return { ...target, latest };
}

function rewriteAttachmentLinkTokens(state) {
  for (const blockToken of state.tokens || []) {
    if (blockToken.type !== "inline" || !Array.isArray(blockToken.children)) continue;
    const children = blockToken.children;
    for (let index = 0; index < children.length; index += 1) {
      const token = children[index];
      if (token.type !== "link_open") continue;
      const href = String(token.attrGet?.("href") || "");
      const target = resolveLinkTarget(href, state.env);
      if (!target) continue;

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
      replacement.meta = { ...target, label: labelParts.join("").trim() };
      children.splice(index, closeIndex - index + 1, replacement);
    }
  }
}

function renderAttachmentToken(tokens, idx, _options, env) {
  const meta = tokens[idx]?.meta || {};
  return renderPrimaryChip(env, meta) + renderLatestChip(env, meta.latest || null);
}

function renderPrimaryChip(env, meta) {
  const { identity, ref, label, superseded } = meta;
  if (meta.unavailableReason) {
    return renderMissingChip(env, { label: label || meta.href, reason: meta.unavailableReason });
  }
  if (meta.mutationRef) {
    return renderMutationChip(env, {
      mutationRef: meta.mutationRef,
      label: label || meta.mutationRef.fileName,
      superseded,
    });
  }
  if (!identity) return escapeHtmlAttribute(ref || "");

  const matched = lookupAttachment(env, identity);
  if (!matched) {
    return renderMissingChip(env, {
      label: label || identity.attachmentId,
      reason: "attachment_not_available",
    });
  }
  return renderResolvedChip(env, {
    ref,
    label: label || matched.name || identity.attachmentId,
    superseded: superseded === true,
  });
}

export function attachmentInlineRefPlugin(md) {
  const validateLink = md.validateLink.bind(md);
  md.validateLink = (url) => isFileLinkHref(url) || validateLink(url);
  md.core.ruler.push(`${ATTACHMENT_INLINE_TOKEN}_links`, rewriteAttachmentLinkTokens);
  md.core.ruler.push(`${ATTACHMENT_INLINE_TOKEN}_text`, rewriteAttachmentTextTokens);
  md.renderer.rules[ATTACHMENT_INLINE_TOKEN] = renderAttachmentToken;
}
