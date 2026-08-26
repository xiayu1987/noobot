/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  createUserMetaBackwrite,
  normalizeUserMetaBackwrites,
} from "@noobot/context-protocol/policy/user-meta-backwrite";
import { deriveContextMessageProjectionId } from "@noobot/context-protocol/message/codec";
import { resolveMessagesByIds } from "@noobot/context-protocol/message/store";
import { updateContextMessageById } from "@noobot/context-protocol/mutation/context";
import { appendUserMetaParsedResult } from "./user-meta.js";

function setBackwrites(runtime = {}, records = []) {
  const normalized = normalizeUserMetaBackwrites(records);
  runtime.userMetaBackwrites = normalized;
  if (runtime.activeMessageContext && typeof runtime.activeMessageContext === "object") {
    runtime.activeMessageContext.userMetaBackwrites = normalized;
  }
  if (
    runtime.stoppedModelMessageSnapshotCandidate &&
    typeof runtime.stoppedModelMessageSnapshotCandidate === "object"
  ) {
    runtime.stoppedModelMessageSnapshotCandidate.userMetaBackwrites = normalized;
  }
  return normalized;
}

export function queueUserMetaBackwrite(
  runtime = {},
  { attachmentRef = "", result = {}, createdAt = "" } = {},
) {
  const sourceMessageUid = String(runtime?.currentUserMessageUid || "").trim();
  const sourceOrigin = String(runtime?.currentUserMessageOrigin || "").trim().toLowerCase();
  if (!sourceMessageUid || sourceOrigin !== "natural") {
    throw new Error("user_meta backwrite requires the current natural user message");
  }
  const userMetaMessageUid = deriveContextMessageProjectionId(sourceMessageUid, "user_meta");
  const backwrite = createUserMetaBackwrite({
    userMetaMessageUid,
    attachmentRef,
    result,
    createdAt: createdAt || new Date().toISOString(),
  });
  const current = Array.isArray(runtime?.userMetaBackwrites) ? runtime.userMetaBackwrites : [];
  if (current.some((item) => item?.backwriteId === backwrite.backwriteId)) return backwrite;
  setBackwrites(runtime, [...current, backwrite]);
  return backwrite;
}

export async function applyPendingUserMetaBackwrites(
  runtime = {},
  {
    turnPersister = null,
    userId = "",
    sessionId = "",
    parentSessionId = "",
    dialogProcessId = "",
    turnScopeId = "",
    persistenceContext = null,
    eventListener = null,
  } = {},
) {
  const records = normalizeUserMetaBackwrites(runtime?.userMetaBackwrites || []);
  if (!records.length) return { appliedCount: 0, remaining: [] };
  const modelContext = runtime?.activeMessageContext;
  if (!modelContext || typeof modelContext !== "object") {
    throw new Error("user_meta backwrite requires the active model context");
  }
  let remaining = records.slice();
  let appliedCount = 0;
  for (const record of records) {
    const [message] = resolveMessagesByIds(modelContext, [record.userMetaMessageUid]);
    if (!message) {
      throw new Error(`user_meta backwrite target not found: ${record.userMetaMessageUid}`);
    }
    const nextContent = appendUserMetaParsedResult(message.content, record.result);
    updateContextMessageById(modelContext, record.userMetaMessageUid, { content: nextContent });
    if (turnPersister && typeof turnPersister.appendAgentMessages === "function") {
      await turnPersister.appendAgentMessages({
        userId,
        sessionId,
        parentSessionId,
        dialogProcessId,
        turnScopeId,
        eventListener,
        persistenceContext,
        messages: [
          {
            ...message,
            content: nextContent,
          },
        ],
      });
    }
    remaining = remaining.slice(1);
    setBackwrites(runtime, remaining);
    appliedCount += 1;
  }
  return { appliedCount, remaining };
}
