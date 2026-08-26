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
import { assertTurnAttachmentsBoundEventData } from "@noobot/session-protocol/turn-attachment-bind";
import { createTurnAcceptanceReceipt } from "@noobot/session-protocol";
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
      messageOrigin: String(currentUserMessage?.messageOrigin || "")
        .trim()
        .toLowerCase(),
      userMetaMaterialized: currentUserMessage?.userMetaMaterialized === true,
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
  bindSessionTurnAttachments,
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
  turnAcceptance = null,
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
  let currentUserMessage;
  let canonicalAttachments = [];
  let reusedTurnResult = null;
  let committedTurnResult = null;
  let turnCommand = null;
  const prepareCanonicalAttachments = async () => {
    const preparedTurnInput =
      typeof prepareTurnInput === "function"
        ? await prepareTurnInput({ buildContextPayload })
        : { userMessageAttachments: attachments };
    canonicalAttachments = Array.isArray(preparedTurnInput?.userMessageAttachments)
      ? preparedTurnInput.userMessageAttachments
      : [];
    buildContextPayload.userMessageAttachments = canonicalAttachments;
    if (preparedTurnInput?.contextBuilder) {
      buildContextPayload.contextBuilder = preparedTurnInput.contextBuilder;
    }
  };
  const acceptanceReceipt = turnAcceptance ? createTurnAcceptanceReceipt(turnAcceptance) : null;
  if (
    acceptanceReceipt &&
    (acceptanceReceipt.sessionId !== sessionId ||
      acceptanceReceipt.turnScopeId !== turnScopeId ||
      acceptanceReceipt.dialogProcessId !== dialogProcessId)
  ) {
    throw new TypeError("Turn acceptance receipt does not match the current execution identity");
  }
  const precommittedUserTurn = Boolean(acceptanceReceipt);
  if (resolvedRunConfig?.reuseExistingUserTurn === true || precommittedUserTurn) {
    if (!precommittedUserTurn) await prepareCanonicalAttachments();
    reusedTurnResult = await assertReusedUserTurnIdentity?.({
      userId,
      sessionId,
      parentSessionId,
      turnScopeId,
      dialogProcessId,
      ...(!precommittedUserTurn ? { attachments: canonicalAttachments } : {}),
      ...(persistenceContext ? { persistenceContext } : {}),
    });
    currentUserMessage = reusedTurnResult?.userMessage;
    if (precommittedUserTurn) {
      if (String(currentUserMessage?.messageUid || "").trim() !== acceptanceReceipt.messageUid) {
        throw new TypeError("accepted Turn message identity does not match Session authority");
      }
      committedTurnResult = {
        session: reusedTurnResult?.session,
        sessionId,
        userMessage: currentUserMessage,
        attachments: currentUserMessage?.attachments || [],
        aggregateVersion: acceptanceReceipt.aggregateVersion,
        deduplicated: true,
      };
      if (acceptanceReceipt.committedEventPublished !== true) {
        emitEvent(
          eventListener,
          "turn_committed",
          assertTurnCommittedEventData({
            sessionId,
            aggregateVersion: committedTurnResult.aggregateVersion,
            dialogProcessId,
            turnScopeId,
            userMessage: currentUserMessage,
          }),
        );
      }
    }
  } else {
    turnCommand = createTurnCommand({
      userId,
      sessionId,
      parentSessionId,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId,
      message: normalizedMessage,
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
  if (resolvedRunConfig?.reuseExistingUserTurn !== true) {
    await prepareCanonicalAttachments();
    if (canonicalAttachments.length > 0) {
      if (typeof bindSessionTurnAttachments !== "function") {
        throw new Error("bindSessionTurnAttachments is required for attachment-bearing Turns");
      }
      const attachmentBinding = await bindSessionTurnAttachments({
        userId,
        sessionId,
        parentSessionId,
        turnScopeId,
        messageUid: String(currentUserMessage?.messageUid || "").trim(),
        attachments: canonicalAttachments,
        expectedAggregateVersion: committedTurnResult?.aggregateVersion,
        commandId: `${String(turnCommand?.commandId || acceptanceReceipt?.commandId || resolvedRunConfig?.commandId || turnScopeId).trim()}:attachments.bind`,
        persistenceContext,
      });
      currentUserMessage = attachmentBinding?.userMessage;
      committedTurnResult = {
        ...committedTurnResult,
        aggregateVersion: attachmentBinding?.aggregateVersion,
        attachments: attachmentBinding?.attachments || [],
        userMessage: currentUserMessage,
      };
      emitEvent(
        eventListener,
        "turn_attachments_bound",
        assertTurnAttachmentsBoundEventData({
          sessionId: attachmentBinding?.session?.sessionId || sessionId,
          aggregateVersion: attachmentBinding?.aggregateVersion,
          dialogProcessId,
          turnScopeId,
          userMessage: currentUserMessage,
        }),
      );
    }
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
