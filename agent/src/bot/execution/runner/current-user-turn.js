/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../events/index.js";
import {
  canonicalMessageId,
  emitContextIdentityDebug,
} from "../../../observability/context-identity-debug.js";
import { assertTurnCommittedEventData } from "@noobot/session-protocol/turn-commit";
import { createTurnCommand, toCommitTurnPayload } from "../turn-command.js";
import { summarizeDebugAttachments } from "./debug-utils.js";

function emitPreparedTurnDebug({
  eventListener,
  sessionId,
  dialogProcessId,
  turnScopeId,
  requestRunConfig,
  scenarioResolvedRunConfig,
  resolvedRunConfig,
  attachments,
  userMessageAttachments,
}) {
  emitEvent(eventListener, "debug_resend_runner_received", {
    sessionId,
    dialogProcessId,
    turnScopeId,
    requestThinkingStartedAt: String(requestRunConfig?.thinkingStartedAt || "").trim(),
    scenarioThinkingStartedAt: String(scenarioResolvedRunConfig?.thinkingStartedAt || "").trim(),
    resolvedThinkingStartedAt: String(resolvedRunConfig?.thinkingStartedAt || "").trim(),
    reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
    attachments: summarizeDebugAttachments(attachments),
    userMessageAttachments: summarizeDebugAttachments(userMessageAttachments),
  });
}

function projectPreparedCurrentUserTurn({
  buildContextPayload,
  canonicalAttachments,
  currentUserMessage,
  turnCommand,
  committedTurnResult,
}) {
  return {
    buildContextPayload,
    canonicalAttachments,
    currentUserMessage,
    turnCommand,
    committedTurnResult,
  };
}

function emitCurrentUserIdentityDebug({
  eventListener,
  resolvedRunConfig,
  userId,
  sessionId,
  parentSessionId,
  dialogProcessId,
  turnScopeId,
  persistedMessageUid,
  currentUserMessage,
  reusedTurnResult,
  committedTurnResult,
}) {
  emitContextIdentityDebug(
    eventListener,
    resolvedRunConfig?.reuseExistingUserTurn === true ? "reusedTurnResolved" : "turnCommitted",
    { userId, sessionId, parentSessionId, dialogProcessId, turnScopeId },
    {
      messageUid: persistedMessageUid,
      persistedMessageId: String(
        currentUserMessage?.messageId || currentUserMessage?.id || "",
      ).trim(),
      canonicalMessageId: canonicalMessageId(currentUserMessage),
      role: String(currentUserMessage?.role || "").trim(),
      frontendUserMessage: currentUserMessage?.frontendUserMessage === true,
      messageOrigin: String(currentUserMessage?.messageOrigin || "").trim(),
      contentLength: String(currentUserMessage?.content || "").length,
      attachmentCount: Array.isArray(currentUserMessage?.attachments)
        ? currentUserMessage.attachments.length
        : 0,
      ...(reusedTurnResult ? { asserted: reusedTurnResult?.asserted === true } : {}),
      ...(committedTurnResult ? { deduplicated: committedTurnResult?.deduplicated === true } : {}),
    },
  );
}

export async function prepareCurrentUserTurn({
  prepareTurnInput,
  assertReusedUserTurnIdentity,
  commitSessionTurn,
  normalizedMessage,
  attachments,
  systemMessages,
  eventListener,
  userInteractionBridge,
  abortSignal,
  parentAsyncResultContainer,
  persistenceContext,
  contextMode,
  userId,
  sessionId,
  parentSessionId,
  dialogProcessId,
  parentDialogProcessId,
  turnScopeId,
  caller,
  userConfig,
  resolvedRunConfig,
  requestRunConfig,
  scenarioResolvedRunConfig,
}) {
  const buildContextPayload = {
    mode: contextMode,
    userId,
    sessionId,
    caller,
    parentSessionId,
    userConfig,
    userMessageAttachments: attachments,
    systemMessages: Array.isArray(systemMessages) ? systemMessages : [],
    eventListener,
    dialogProcessId,
    userInteractionBridge,
    runConfig: resolvedRunConfig,
    abortSignal,
    parentAsyncResultContainer,
    persistenceContext,
  };
  emitPreparedTurnDebug({
    eventListener,
    sessionId,
    dialogProcessId,
    turnScopeId,
    requestRunConfig,
    scenarioResolvedRunConfig,
    resolvedRunConfig,
    attachments,
    userMessageAttachments: buildContextPayload.userMessageAttachments,
  });
  const preparedTurnInput =
    typeof prepareTurnInput === "function"
      ? await prepareTurnInput({ buildContextPayload })
      : { userMessageAttachments: attachments };
  const canonicalAttachments = Array.isArray(preparedTurnInput?.userMessageAttachments)
    ? preparedTurnInput.userMessageAttachments
    : [];
  buildContextPayload.userMessageAttachments = canonicalAttachments;
  if (preparedTurnInput?.contextBuilder)
    buildContextPayload.contextBuilder = preparedTurnInput.contextBuilder;

  let currentUserMessage;
  let reusedTurnResult = null;
  let committedTurnResult = null;
  let turnCommand = null;
  if (resolvedRunConfig?.reuseExistingUserTurn === true) {
    reusedTurnResult = await assertReusedUserTurnIdentity?.({
      userId,
      sessionId,
      parentSessionId,
      turnScopeId,
      dialogProcessId,
      attachments: canonicalAttachments,
      ...(persistenceContext ? { persistenceContext } : {}),
    });
    currentUserMessage = reusedTurnResult?.userMessage;
  } else {
    turnCommand = createTurnCommand({
      userId,
      sessionId,
      parentSessionId,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId,
      message: normalizedMessage,
      attachments: canonicalAttachments,
      runConfig: resolvedRunConfig,
      caller,
    });
    if (typeof commitSessionTurn !== "function") {
      throw new Error("commitSessionTurn is required before Context construction");
    }
    committedTurnResult = await commitSessionTurn({
      ...toCommitTurnPayload(turnCommand),
      persistenceContext,
    });
    currentUserMessage = committedTurnResult?.userMessage;
    canonicalAttachments.splice(
      0,
      canonicalAttachments.length,
      ...(committedTurnResult?.attachments || []),
    );
    emitEvent(
      eventListener,
      "turn_committed",
      assertTurnCommittedEventData({
        sessionId: committedTurnResult?.sessionId || sessionId,
        aggregateVersion: committedTurnResult?.aggregateVersion,
        dialogProcessId,
        turnScopeId,
        userMessage: currentUserMessage,
      }),
    );
  }
  const persistedMessageUid = String(currentUserMessage?.messageUid || "").trim();
  if (!persistedMessageUid) {
    throw new Error(
      "persisted current user message identity is required before Context construction",
    );
  }
  emitCurrentUserIdentityDebug({
    eventListener,
    resolvedRunConfig,
    userId,
    sessionId,
    parentSessionId,
    dialogProcessId,
    turnScopeId,
    persistedMessageUid,
    currentUserMessage,
    reusedTurnResult,
    committedTurnResult,
  });
  buildContextPayload.currentUserMessage = currentUserMessage;
  return projectPreparedCurrentUserTurn({
    buildContextPayload,
    canonicalAttachments,
    currentUserMessage,
    turnCommand,
    committedTurnResult,
  });
}
