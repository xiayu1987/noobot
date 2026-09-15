/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import {
  logResendDebug,
  summarizeDebugAttachments,
  summarizeDebugMessage,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
  summarizeStateMachineTurn,
} from "../../../debug/loggers/stateMachineLogger.js";
import { resolveSessionTurnRuntime } from "../run-state-machine/turnRuntimeRegistry.js";

const sessionMessages = (ctx) =>
  Array.isArray(ctx.activeSession?.value?.messages) ? ctx.activeSession.value.messages : [];
const debugMessages = (ctx) => summarizeDebugMessages(ctx.activeSession?.value?.messages);
const errorText = (error) => String(error?.message || error || "");

function logBegin(ctx, { reuseExistingUserTurn, allowDuringResend, hasText, uploadCount }) {
  ctx.logSessionEvent({
    category: "message",
    event: "send.begin",
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
    data: { reuseExistingUserTurn, allowDuringResend, hasText, uploadCount },
  });
  logResendDebug("send.begin", () => ({
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
    reuseExistingUserTurn,
    allowDuringResend,
    ...ctx.runtimeView(),
    messages: debugMessages(ctx),
  }));
}

function logPrepareAfter(ctx, params) {
  logStateMachineDebug("stateMachine.send.presentationCreated", () => ({
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
    reuseExistingUserTurn: params.reuseExistingUserTurn,
    requestedUserMessageId: params.userMessageId,
    requestedPresentationMessageId: params.assistantMessageId,
    userMessage: summarizeStateMachineMessage(params.userMessage),
    assistantMessage: summarizeStateMachineMessage(params.botMessage),
    messages: sessionMessages(ctx).map(summarizeStateMachineMessage),
  }));
  logResendDebug("send.prepare.after", () => ({
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
    explicitUserAttachments: summarizeDebugAttachments(params.explicitUserAttachments),
    explicitTransportAttachments: summarizeDebugAttachments(params.explicitTransportAttachments),
    filesToSend: summarizeDebugAttachments(params.filesToSend),
    botMessage: summarizeDebugMessage(params.botMessage),
    messages: debugMessages(ctx),
  }));
}

function logStreamBefore(ctx, params) {
  const { payload, attachments } = params;
  const isResend = payload?.commandType === AGENT_COMMAND.RESEND;
  ctx.logSessionEvent({
    category: "transport",
    event: "stream.start",
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
    data: {
      requestedTextStreaming: params.requestedTextStreaming,
      attachmentCount: attachments.length,
      reuseExistingUserTurn: isResend,
    },
  });
  logResendDebug("send.stream.before", () => ({
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
    payloadTurnScopeId: payload?.identity?.turnScopeId,
    reuseExistingUserTurn: isResend,
    explicitUserAttachments: summarizeDebugAttachments(params.explicitUserAttachments),
    explicitTransportAttachments: summarizeDebugAttachments(params.explicitTransportAttachments),
    filesToSend: summarizeDebugAttachments(params.filesToSend),
    attachments: summarizeDebugAttachments(attachments),
    payloadAttachments: summarizeDebugAttachments(payload?.input?.attachments),
    botMessage: summarizeDebugMessage(params.botMessage),
    botThinkingStartedAt: params.botMessage?.thinkingStartedAt || "",
  }));
}

function logResolved(ctx, { botMessage }) {
  logStateMachineDebug("stateMachine.stream.resolved", () => ({
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
    botMessage: summarizeStateMachineMessage(botMessage),
  }));
  ctx.logSessionEvent({
    category: "message",
    event: "send.resolved",
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
  });
  logResendDebug("send.doneReturn", () => ({
    turnScopeId: ctx.turnScopeId,
    messages: debugMessages(ctx),
  }));
}

function logError(ctx, { error, hasStreamErrorEventData }) {
  logResendDebug("send.catch.error", () => ({
    turnScopeId: ctx.turnScopeId,
    error: errorText(error),
    messages: debugMessages(ctx),
  }));
  ctx.logSessionEvent({
    category: "message",
    level: "error",
    event: "send.error",
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
    message: errorText(error),
    data: {
      error: errorText(error),
      hasStreamErrorEventData: Boolean(hasStreamErrorEventData),
    },
  });
}

function logCleanup(ctx, { pendingInteractionRequest, interactionSubmitting }) {
  logResendDebug("send.cleanup", () => ({
    turnScopeId: ctx.turnScopeId,
    ...ctx.runtimeView(),
    messages: debugMessages(ctx),
  }));
  ctx.logSessionEvent({
    category: "message",
    event: "send.cleanup",
    sessionId: ctx.sessionId,
    turnScopeId: ctx.turnScopeId,
    data: ctx.runtimeView(),
  });
  logStateMachineDebug("stateMachine.send.cleanup", () => {
    const messages = sessionMessages(ctx);
    const runtime = ctx.runtimeView();
    const turn = resolveSessionTurnRuntime(
      ctx.turnRuntimeRegistry?.value,
      ctx.sessionId,
      ctx.turnScopeId,
    );
    return {
      sessionId: ctx.sessionId,
      turnScopeId: ctx.turnScopeId,
      runtime: summarizeStateMachineTurn(turn, runtime),
      pendingMessageCount: messages.filter((message) => message?.pending === true).length,
      messageCount: messages.length,
      interactionPending: Boolean(pendingInteractionRequest?.value),
      interactionSubmitting: interactionSubmitting?.value === true,
    };
  });
}

/**
 * Collects the six diagnostic log points of the chat send flow behind one
 * facade. Mutable closure state (runtime view, turn registry) is passed as
 * getters so every emission observes the value at call time.
 */
export function createSendFlowDebugLogger(context) {
  return {
    begin: (params) => logBegin(context, params),
    prepareAfter: (params) => logPrepareAfter(context, params),
    streamBefore: (params) => logStreamBefore(context, params),
    resolved: (params) => logResolved(context, params),
    error: (params) => logError(context, params),
    cleanup: (params) => logCleanup(context, params),
  };
}
