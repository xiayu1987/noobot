/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  createUserMetaBackwrite,
  isSameUserMetaBackwrite,
  mergeUserMetaParsedResults,
  normalizeUserMetaBackwrites,
} from "@noobot/context-protocol/policy/user-meta-backwrite";
import { resolveMessagesByIds } from "@noobot/context-protocol/message/store";
import {
  readContextMessageValue,
  writeContextMessageMetadata,
} from "@noobot/context-protocol/message/codec";
import { isNaturalDialogUserMessage } from "@noobot/session-protocol";
import { requireActiveModelContext } from "../../../runtime/active-model-context.js";

function setBackwrites(modelContext, records) {
  modelContext.userMetaBackwrites = normalizeUserMetaBackwrites(records);
}

export function queueUserMetaBackwrite(runtime, { attachmentRef, result, createdAt = "" }) {
  const sourceMessage = runtime.currentUserMessage;
  if (!sourceMessage || !isNaturalDialogUserMessage(sourceMessage)) {
    throw new Error("user_meta backwrite requires the current natural user message");
  }
  const backwrite = createUserMetaBackwrite({
    userMetaSourceMessageUid: sourceMessage.messageUid,
    attachmentRef,
    result,
    createdAt: createdAt || new Date().toISOString(),
  });
  const modelContext = requireActiveModelContext(runtime);
  const current = modelContext.userMetaBackwrites;
  if (current.some((item) => isSameUserMetaBackwrite(item, backwrite))) return backwrite;
  setBackwrites(modelContext, [...current, backwrite]);
  return backwrite;
}

export async function applyPendingUserMetaBackwrites(
  runtime,
  { session, userId, sessionId, persistenceScope },
) {
  const modelContext = requireActiveModelContext(runtime);
  const records = modelContext.userMetaBackwrites;
  if (!records.length) return { appliedCount: 0, remaining: [] };
  let remaining = records.slice();
  let appliedCount = 0;
  for (const record of records) {
    const [source] = resolveMessagesByIds(modelContext, [record.userMetaSourceMessageUid]);
    if (!source) {
      throw new Error(`user_meta backwrite source not found: ${record.userMetaSourceMessageUid}`);
    }
    const outcome = await session.recordUserMetaParsedResult({
      userId,
      sessionId,
      persistenceScope,
      userMetaSourceMessageUid: record.userMetaSourceMessageUid,
      result: record.result,
    });
    if (outcome?.recorded !== true) {
      throw new Error(`user_meta backwrite was not recorded: ${record.userMetaSourceMessageUid}`);
    }
    writeContextMessageMetadata(source, {
      userMetaParsedResults: mergeUserMetaParsedResults(
        readContextMessageValue(source, "userMetaParsedResults"),
        record.result,
      ),
    });
    remaining = remaining.slice(1);
    setBackwrites(modelContext, remaining);
    appliedCount += 1;
  }
  return { appliedCount, remaining };
}
