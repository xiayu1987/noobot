/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_UPGRADE_OWNER } from "@noobot/workspace-protocol";
import {
  decodeToolResultText,
  encodeToolResultObject,
  toolResultOverflow,
} from "@noobot/event-protocol/tool-result";
import { decodeToolResultText as decodeV24Result } from "@noobot/event-protocol/tool-result-v24";
import { TOOL_RESULT_MESSAGE_TYPE } from "@noobot/session-protocol";
import { formatAttachmentIdentityRef } from "@noobot/attachment-protocol";
import {
  getTransferSourceReferences,
  mergeTransferEnvelopes,
} from "@noobot/semantic-transfer-protocol";
import { isDeepStrictEqual } from "node:util";
import { createSessionMessageRewriter } from "./session-message-rewrite.js";
import { upgradeSessionDirectories } from "./session-upgrade-driver.js";
import { ignoreSessionProgress } from "./session-directory-walk.js";

function upgradeError(reason, details, cause) {
  const error = new Error(`workspace session result overflow upgrade failed: ${reason}`, { cause });
  error.code = "WORKSPACE_SESSION_RESULT_OVERFLOW_UPGRADE_INVALID";
  error.details = { reason, ...details };
  return error;
}

const RETIRED_FIELDS = [
  "outputOverflow",
  "outputDelivery",
  "outputTransferReason",
  "overflow_reason",
  "attachmentRefs",
  "sourceReferences",
  "contentStoredInFile",
];

function callKey(turnScopeId, callId) {
  if (typeof turnScopeId !== "string" || !turnScopeId || typeof callId !== "string" || !callId) {
    throw upgradeError("call_identity_missing", { turnScopeId, callId });
  }
  return JSON.stringify([turnScopeId, callId]);
}

async function collectTransfers(context) {
  if (context.shared.overflowTransfers) return context.shared.overflowTransfers;
  const index = new Map();
  const add = (key, transfers) => {
    index.set(key, mergeTransferEnvelopes(index.get(key), transfers));
  };
  for (const message of await context.loadSessionMessages()) {
    if (message.type === TOOL_RESULT_MESSAGE_TYPE)
      add(callKey(message.turnScopeId, message.tool_call_id), message.transferEnvelopes);
    for (const item of message.toolTimeline ?? [])
      add(callKey(message.turnScopeId, item.toolCallId), item.transferEnvelopes);
  }
  context.shared.overflowTransfers = index;
  return index;
}

export function migrateOverflowResultText(resultText, transfers = []) {
  const result = decodeV24Result(resultText);
  const retired = RETIRED_FIELDS.some((key) => Object.hasOwn(result, key));
  const legacySummary = Object.hasOwn(result.summary ?? {}, "original_length");
  if (!retired && !legacySummary && !(result.overflowed && !result.transferEnvelopes?.length)) {
    decodeToolResultText(resultText);
    return null;
  }
  const next = { ...result };
  for (const field of RETIRED_FIELDS) delete next[field];
  if (legacySummary) {
    const { original_length: _length, max_length: _maxLength, ...rest } = result.summary;
    if (Object.keys(rest).length) next.summary = rest;
    else delete next.summary;
  }
  const envelopes = mergeTransferEnvelopes(result.transferEnvelopes, transfers);
  assertLegacyReferences(result, envelopes);
  if (result.outputOverflow === true || result.overflowed === true)
    Object.assign(
      next,
      toolResultOverflow({ message: result.message, transferEnvelopes: envelopes }),
    );
  else if (envelopes.length) next.transferEnvelopes = envelopes;
  return encodeToolResultObject(next);
}

function assertLegacyReferences(result, envelopes) {
  if (result.attachmentRefs?.length) {
    const refs = new Set(
      envelopes.flatMap((e) =>
        e.payload.mode === "attachment"
          ? e.payload.attachments.map((a) => formatAttachmentIdentityRef(a.identity))
          : [],
      ),
    );
    const missing = result.attachmentRefs.filter((ref) => !refs.has(ref));
    if (missing.length) throw upgradeError("attachment_transfer_missing", { missing });
  }
  if (result.sourceReferences?.length) {
    const references = getTransferSourceReferences(envelopes).map(
      ({ address, startLine, endLine, totalLines }) => ({
        ...(typeof address === "string"
          ? { filePath: address }
          : { attachmentRef: formatAttachmentIdentityRef(address) }),
        startLine,
        endLine,
        totalLines,
      }),
    );
    for (const reference of result.sourceReferences) {
      if (!references.some((candidate) => isDeepStrictEqual(candidate, reference))) {
        throw upgradeError("source_transfer_missing", { reference });
      }
    }
  }
}

async function migrateText(text, context, key) {
  const transfers = (await collectTransfers(context)).get(key);
  return migrateOverflowResultText(text, transfers);
}

async function migrateMessage(message, context) {
  let next = message;
  if (message.type === TOOL_RESULT_MESSAGE_TYPE) {
    const content = await migrateText(
      message.content,
      context,
      callKey(message.turnScopeId, message.tool_call_id),
    );
    if (content !== null) next = { ...next, content };
  }
  if (message.toolTimeline === undefined) return next;
  let changed = false;
  const toolTimeline = [];
  for (const item of message.toolTimeline) {
    const result =
      item.result === undefined
        ? null
        : await migrateText(item.result, context, callKey(message.turnScopeId, item.toolCallId));
    if (result === null) toolTimeline.push(item);
    else {
      changed = true;
      toolTimeline.push({ ...item, result });
    }
  }
  return changed ? { ...next, toolTimeline } : next;
}

const rewriter = createSessionMessageRewriter({
  upgradeError,
  migrateMessage,
  migrateOutboxToolResult: (payload, context) =>
    migrateText(payload.result, context, callKey(context.identity.turnScopeId, payload.toolCallId)),
});

export async function upgradeSessionResultOverflow({
  base,
  scopedSessionRoots,
  onSessionProcessed = ignoreSessionProgress,
}) {
  if (!Array.isArray(scopedSessionRoots) || !scopedSessionRoots.length)
    throw new TypeError("session result overflow upgrade requires scopedSessionRoots");
  return upgradeSessionDirectories({
    base,
    roots: [WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots],
    kind: WORKSPACE_LAYOUT_UPGRADE_OWNER.SESSION_RESULT_OVERFLOW,
    upgrade: ({ sessionDir }) =>
      rewriter.upgradeSessionDirectory({ base, backupBase: null, sessionDir }),
    quarantineCode: "WORKSPACE_SESSION_RESULT_OVERFLOW_UPGRADE_INVALID",
    normalizeError: (error) => error,
    onSessionProcessed,
  });
}
