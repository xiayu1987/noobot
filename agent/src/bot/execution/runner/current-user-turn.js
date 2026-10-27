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

function emitPreparedTurnDebug({
  eventListener,
  resolvedRunConfig,
  attachments,
  userMessageAttachments,
}) {
  emitEvent(eventListener, "debug_resend_runner_received", {
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
      role: currentUserMessage.role,
      messageOrigin: currentUserMessage.messageOrigin,
      contentLength: currentUserMessage.content.length,
      attachmentCount: currentUserMessage.attachments.length,
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
  runtimeIdentity,
  userConfig,
  resolvedRunConfig,
  turnAcceptance = null,
}) {
  const { userId, sessionId, dialogProcessId, turnScopeId } = runtimeIdentity;
  const buildContextPayload = {
    mode: contextMode,
    runtimeIdentity,
    userConfig,
    userMessageAttachments: attachments,
    systemMessages,
    eventListener,
    userInteractionBridge,
    runConfig: resolvedRunConfig,
    abortSignal,
    persistenceScope,
  };
  emitPreparedTurnDebug({
    eventListener,
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
  currentUserMessage = reusedTurnResult.userMessage;
  if (precommittedUserTurn) {
    if (currentUserMessage.messageUid !== acceptanceReceipt.messageUid) {
      throw new TypeError("accepted Turn message identity does not match Session authority");
    }
    committedTurnResult = {
      session: reusedTurnResult.session,
      sessionId,
      userMessage: currentUserMessage,
      attachments: currentUserMessage.attachments,
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
      messageUid: currentUserMessage.messageUid,
      attachments: canonicalAttachments,
      expectedAggregateVersion: committedTurnResult?.aggregateVersion,
      commandId: deriveAttachmentBindCommandId(turnScopeId),
      persistenceScope,
    });
    currentUserMessage = attachmentBinding.userMessage;
    committedTurnResult = {
      ...committedTurnResult,
      aggregateVersion: attachmentBinding.aggregateVersion,
      attachments: attachmentBinding.attachments,
      userMessage: currentUserMessage,
    };
    emitEvent(
      eventListener,
      AGENT_RUN_EVENT.TURN_ATTACHMENTS_BOUND,
      assertTurnAttachmentsBoundEventData({
        sessionId,
        aggregateVersion: attachmentBinding.aggregateVersion,
        dialogProcessId,
        turnScopeId,
        userMessage: currentUserMessage,
      }),
    );
  }
  const persistedMessageUid = currentUserMessage.messageUid;
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
