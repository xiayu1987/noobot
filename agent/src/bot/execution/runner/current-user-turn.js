/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_RUN_EVENT, emitEvent } from "../../../events/index.js";
import { emitContextIdentityDebug } from "../../../observability/context-identity-debug.js";
import { assertTurnCommittedEventData } from "@noobot/session-protocol/turn-commit";
import { assertTurnAttachmentsBoundEventData } from "@noobot/session-protocol/turn-attachment-bind";
import {
  createTurnAcceptanceReceipt,
  deriveAttachmentBindCommandId,
} from "@noobot/session-protocol";
import { summarizeDebugAttachments } from "@noobot/shared/debug-projection";
import { text } from "@noobot/shared/value";

function emitPreparedTurnDebug({
  eventListener,
  requestRunConfig,
  scenarioResolvedRunConfig,
  resolvedRunConfig,
  attachments,
  userMessageAttachments,
}) {
  emitEvent(eventListener, "debug_resend_runner_received", {
    requestThinkingStartedAt: text(requestRunConfig?.thinkingStartedAt),
    scenarioThinkingStartedAt: text(scenarioResolvedRunConfig?.thinkingStartedAt),
    resolvedThinkingStartedAt: text(resolvedRunConfig?.thinkingStartedAt),
    reuseExistingUserTurn: resolvedRunConfig?.reuseExistingUserTurn === true,
    attachments: summarizeDebugAttachments(attachments),
    userMessageAttachments: summarizeDebugAttachments(userMessageAttachments),
  });
}

function projectPreparedCurrentUserTurn({
  buildContextPayload,
  canonicalAttachments,
  currentUserMessage,
  committedTurnResult,
}) {
  return {
    buildContextPayload,
    canonicalAttachments,
    currentUserMessage,
    committedTurnResult,
  };
}

function emitCurrentUserIdentityDebug({
  eventListener,
  resolvedRunConfig,
  persistedMessageUid,
  currentUserMessage,
  reusedTurnResult,
  committedTurnResult,
}) {
  emitContextIdentityDebug(
    eventListener,
    resolvedRunConfig?.reuseExistingUserTurn === true ? "reusedTurnResolved" : "turnCommitted",
    {
      messageUid: persistedMessageUid,
      role: text(currentUserMessage?.role),
      messageOrigin: text(currentUserMessage?.messageOrigin).toLowerCase(),
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
  buildContextBuilder,
  prepareTurnInput,
  assertReusedUserTurnIdentity,
  bindSessionTurnAttachments,
  attachments,
  systemMessages,
  eventListener,
  userInteractionBridge,
  abortSignal,
  persistenceScope,
  contextMode,
  userId,
  sessionId,
  parentSessionId,
  dialogProcessId,
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
    systemMessages,
    eventListener,
    dialogProcessId,
    turnScopeId,
    userInteractionBridge,
    runConfig: resolvedRunConfig,
    abortSignal,
    persistenceScope,
  };
  emitPreparedTurnDebug({
    eventListener,
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
  const prepareCanonicalAttachments = async () => {
    canonicalAttachments = (await prepareTurnInput({ buildContextPayload })).userMessageAttachments;
    buildContextPayload.userMessageAttachments = canonicalAttachments;
  };
  const acceptanceReceipt = turnAcceptance ? createTurnAcceptanceReceipt(turnAcceptance) : null;
  const reuseExistingUserTurn = resolvedRunConfig?.reuseExistingUserTurn === true;
  if (!acceptanceReceipt && !reuseExistingUserTurn) {
    throw new TypeError("accepted Turn receipt is required before Context construction");
  }
  if (
    acceptanceReceipt &&
    (acceptanceReceipt.sessionId !== sessionId ||
      acceptanceReceipt.turnScopeId !== turnScopeId ||
      acceptanceReceipt.dialogProcessId !== dialogProcessId)
  ) {
    throw new TypeError("Turn acceptance receipt does not match the current execution identity");
  }
  const precommittedUserTurn = Boolean(acceptanceReceipt);
  if (!precommittedUserTurn) await prepareCanonicalAttachments();
  reusedTurnResult = await assertReusedUserTurnIdentity({
    userId,
    sessionId,
    turnScopeId,
    dialogProcessId,
    ...(!precommittedUserTurn ? { attachments: canonicalAttachments } : {}),
    persistenceScope,
  });
  currentUserMessage = reusedTurnResult?.userMessage;
  if (precommittedUserTurn) {
    if (text(currentUserMessage?.messageUid) !== acceptanceReceipt.messageUid) {
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
        AGENT_RUN_EVENT.TURN_COMMITTED,
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
  if (precommittedUserTurn) await prepareCanonicalAttachments();
  if (!reuseExistingUserTurn && canonicalAttachments.length > 0) {
    const attachmentBinding = await bindSessionTurnAttachments({
      userId,
      sessionId,
      turnScopeId,
      messageUid: text(currentUserMessage?.messageUid),
      attachments: canonicalAttachments,
      expectedAggregateVersion: committedTurnResult?.aggregateVersion,
      commandId: deriveAttachmentBindCommandId(turnScopeId),
      persistenceScope,
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
      AGENT_RUN_EVENT.TURN_ATTACHMENTS_BOUND,
      assertTurnAttachmentsBoundEventData({
        sessionId,
        aggregateVersion: attachmentBinding?.aggregateVersion,
        dialogProcessId,
        turnScopeId,
        userMessage: currentUserMessage,
      }),
    );
  }
  const persistedMessageUid = text(currentUserMessage?.messageUid);
  if (!persistedMessageUid) {
    throw new Error(
      "persisted current user message identity is required before Context construction",
    );
  }
  emitCurrentUserIdentityDebug({
    eventListener,
    resolvedRunConfig,
    persistedMessageUid,
    currentUserMessage,
    reusedTurnResult,
    committedTurnResult,
  });
  buildContextPayload.currentUserMessage = currentUserMessage;
  buildContextPayload.contextBuilder = buildContextBuilder(buildContextPayload);
  return projectPreparedCurrentUserTurn({
    buildContextPayload,
    canonicalAttachments,
    currentUserMessage,
    committedTurnResult,
  });
}
