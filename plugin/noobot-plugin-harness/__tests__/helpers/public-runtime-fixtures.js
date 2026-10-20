/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createModelContext, resolveModelFinalMessages } from "@noobot/context-protocol";
import { createHookManager, HOOK_PROTOCOL_VERSION } from "@noobot/hook-protocol";
import {
  attachmentTransfer,
  directTransfer,
  TRANSFER_DIRECTION,
} from "@noobot/semantic-transfer-protocol";
import { createModelResponse, MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { migrateHarnessBucket } from "../../src/core/bucket-migration.js";

import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";
let testScopeSequence = 0;
let testTransferSequence = 0;
let testModelResponseSequence = 0;

export function createTestModelResponse(
  outputText,
  {
    reasoning = "",
    toolCalls = [],
    finishReason = "stop",
    usage = {},
    content = undefined,
    responseOutput = undefined,
    responseReasoning = undefined,
    attempts = null,
    identity = {},
  } = {},
) {
  testModelResponseSequence += 1;
  const sequence = testModelResponseSequence;
  const output = {
    text: String(outputText ?? ""),
    reasoning: String(reasoning ?? ""),
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
    finishReason: String(finishReason ?? ""),
    usage: isPlainObject(usage) ? usage : {},
    ...(typeof content === "string" || Array.isArray(content) ? { content } : {}),
    ...(Array.isArray(responseOutput) ? { responseOutput } : {}),
    ...(isPlainObject(responseReasoning) ? { responseReasoning } : {}),
  };
  const normalizedAttempts =
    Array.isArray(attempts) && attempts.length
      ? attempts
      : [{ attempt: 1, status: "completed", kind: "response", streaming: false, output }];
  return createModelResponse({
    invocation: {
      requestId: `test-model-request-${sequence}`,
      invocationId: `test-model-invocation-${sequence}`,
      sessionId: String(identity.sessionId || `test-model-session-${sequence}`),
      parentSessionId: String(identity.parentSessionId || ""),
      dialogProcessId: String(identity.dialogProcessId || `test-model-dialog-${sequence}`),
      turnScopeId: String(identity.turnScopeId || `test-model-turn-${sequence}`),
      runId: String(identity.runId || `test-model-run-${sequence}`),
      flow: "harness.test",
      purpose: "harness_test",
      domain: "test",
      contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
    },
    output,
    attemptCount: normalizedAttempts.length,
    attempts: normalizedAttempts,
    model: {
      model: "test-model",
      format: "openai_compatible",
      providerId: "test-provider",
      adapterId: "openai-compatible",
    },
    provider: {
      operatorId: "test-provider",
      adapterId: "openai-compatible",
    },
  });
}

function initializeTestSemanticTransfer(agentContext = {}) {
  const runtime = agentContext?.bindings?.runtime;
  if (!isObjectLike(runtime)) return;
  const sharedTools =
    runtime.sharedTools && typeof runtime.sharedTools === "object"
      ? runtime.sharedTools
      : (runtime.sharedTools = {});
  if (typeof sharedTools?.semanticTransfer?.transferSemanticContent === "function") return;
  sharedTools.semanticTransfer = {
    async transferSemanticContent(payload = {}) {
      testTransferSequence += 1;
      const identitySource = agentContext?.context?.identity || {};
      const sessionId = text(identitySource.sessionId);
      const producer =
        payload?.producer && typeof payload.producer === "object"
          ? payload.producer
          : { type: "plugin", id: "harness-test" };
      const common = {
        transferId: `test-transfer-${testTransferSequence}`,
        messageId: `test-transfer-message-${testTransferSequence}`,
        identity: {
          sessionId,
          turnScopeId: text(identitySource.turnScopeId),
          runId: text(identitySource.runId),
          producer,
        },
        direction: payload.direction || TRANSFER_DIRECTION.OUTPUT,
        intent: {
          source: String(payload.source || producer.type || "plugin").trim(),
          reason: String(payload.reason || payload.strategy || "harness_test_transfer").trim(),
          scenario: text(payload.scenario) || "harness",
          strategy: text(payload.strategy) || "harness_summary",
        },
      };
      if (
        payload.strategy === "harness_summary" &&
        (payload.fullText !== undefined || payload.summaryText !== undefined)
      ) {
        const injectMode = text(payload.injectMode) || "full";
        const content =
          injectMode === "summary"
            ? String(payload.summaryText || "")
            : String(payload.fullText || payload.summaryText || "");
        return { transferEnvelopes: [directTransfer({ ...common, content })] };
      }
      const content = String(payload.detail || payload.content || payload.text || "");
      const name = text(payload.name) || `harness-test-${testTransferSequence}.md`;
      return {
        transferEnvelopes: [
          attachmentTransfer({
            ...common,
            attachments: [
              {
                identity: {
                  attachmentId: `test-attachment-${testTransferSequence}`,
                  sessionId,
                  attachmentSource: text(payload.attachmentSource) || "model",
                },
                role: "primary",
                name,
                mimeType: text(payload.mimeType) || "text/plain",
                size: Buffer.byteLength(content, "utf8"),
              },
            ],
            meta: { persisted: true },
          }),
        ],
      };
    },
  };
}

export function ensureTestAgentExecutionScope(ctx = {}) {
  if (!isObjectLike(ctx)) return null;
  const agentContext =
    ctx.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return null;
  const bindings =
    agentContext.bindings && typeof agentContext.bindings === "object"
      ? agentContext.bindings
      : (agentContext.bindings = {});
  const runtime = isObjectLike(bindings.runtime) ? bindings.runtime : {};
  const systemRuntime = isObjectLike(runtime.systemRuntime) ? runtime.systemRuntime : {};
  if (!isObjectLike(agentContext.context)) {
    testScopeSequence += 1;
    const scopeSuffix = String(testScopeSequence);
    const dialogProcessId = text(ctx.dialogProcessId) || `test-dialog-${scopeSuffix}`;
    const turnScopeId = text(ctx.turnScopeId) || `test-turn:${dialogProcessId}`;
    const sessionId = text(ctx.sessionId) || `test-session-${scopeSuffix}`;
    agentContext.context = {
      kind: "noobot.agent-context",
      protocolVersion: 1,
      identity: {
        userId: text(systemRuntime.userId) || `test-user-${scopeSuffix}`,
        sessionId,
        rootSessionId: String(ctx.rootSessionId || sessionId).trim(),
        parentSessionId: text(ctx.parentSessionId),
        dialogProcessId,
        turnScopeId,
        runId: text(ctx.runId) || `test-run-${scopeSuffix}`,
      },
      environment: {},
      execution: {},
      modelContext: null,
    };
  }
  bindings.runtime = createTestRuntimeBinding({
    userId: agentContext.context.identity.userId,
    runtime,
    systemRuntime,
  });
  bindings.tools = Array.isArray(bindings.tools) ? bindings.tools : [];
  bindings.extensions = isObjectLike(bindings.extensions) ? bindings.extensions : {};
  bindings.extensions.harness = isObjectLike(bindings.extensions.harness)
    ? bindings.extensions.harness
    : {};
  initializeTestSemanticTransfer(agentContext);
  return agentContext;
}

function createTestRuntimeBinding({ userId, runtime, systemRuntime }) {
  if (systemRuntime.userId !== undefined && systemRuntime.userId !== userId) {
    throw new Error("test fixture systemRuntime.userId must equal context.identity.userId");
  }
  return {
    basePath: `/test-workspace/${userId}`,
    globalConfig: {},
    ...runtime,
    systemRuntime: { ...systemRuntime, userId },
  };
}

export function ensureTestHookContext(ctx = {}) {
  if (!isObjectLike(ctx)) return ctx;
  ensureTestAgentExecutionScope(ctx);
  const explicitIdentity =
    ctx.activeTurnIdentity && typeof ctx.activeTurnIdentity === "object"
      ? ctx.activeTurnIdentity
      : null;
  const dialogProcessId =
    text(ctx.dialogProcessId) || text(explicitIdentity?.dialogProcessId) || "test-dialog";
  const turnScopeId =
    text(ctx.turnScopeId) || text(explicitIdentity?.turnScopeId) || `test-turn:${dialogProcessId}`;
  const activeTurnIdentity = { dialogProcessId, turnScopeId };
  const stampRoundIdentity = (messages = []) => {
    for (const message of Array.isArray(messages) ? messages : []) {
      if (!isObjectLike(message)) continue;
      const role = String(message?.role || message?.type || "")
        .trim()
        .toLowerCase();
      if (role === "system" || role === "developer") continue;
      if (!text(message.dialogProcessId)) message.dialogProcessId = dialogProcessId;
      if (!text(message.turnScopeId)) message.turnScopeId = turnScopeId;
    }
  };
  stampRoundIdentity(ctx.messageBlocks?.history);
  stampRoundIdentity(ctx.messageBlocks?.incremental);
  if (ctx.modelContext?.protocolVersion !== 3) {
    ctx.modelContext = createModelContext({
      messageBlocks: ctx.messageBlocks || { system: [], history: [], incremental: [] },
      activeTurnIdentity,
    });
    ctx.contextProtocolVersion = 2;
  }
  if (!ctx.modelContext.activeTurnIdentity) {
    ctx.modelContext.activeTurnIdentity = activeTurnIdentity;
  }
  delete ctx.messageBlocks;
  delete ctx.activeTurnIdentity;
  migrateHarnessBucket(ctx);
  return ctx;
}

export function createTestHookContext(ctx = {}, context = {}) {
  return ensureTestHookContext({
    ...ctx,
    messageBlocks: context.messageBlocks ?? ctx.messageBlocks,
    activeTurnIdentity: context.activeTurnIdentity ?? ctx.activeTurnIdentity,
  });
}

export function getTestContextMessages(ctx = {}) {
  return ctx?.modelContext?.messages || [];
}

export function getTestContextMessageBlocks(ctx = {}) {
  return (
    ctx?.modelContext?.messageBlocks || {
      system: [],
      history: [],
      incremental: [],
    }
  );
}

export function createTestHookManager() {
  const manager = createHookManager();
  return Object.freeze({
    ...manager,
    async emit(point, context = {}, options = {}) {
      ensureTestHookContext(context);
      return manager.emit(point, context, options);
    },
  });
}

export function invokeTestHookHandler(handler, point, ctx, signal) {
  return handler(ctx, {
    protocolVersion: HOOK_PROTOCOL_VERSION,
    point,
    handlerId: `test.${point}`,
    signal,
  });
}

export function createTestResolveModelMessages() {
  return ({ ctx = {} } = {}) => {
    const modelContext = ctx?.modelContext;
    if (modelContext?.protocolVersion !== 3) {
      throw new Error("test model resolver requires modelContext protocolVersion=3");
    }
    const blocks = modelContext.messageBlocks;
    if (!isObjectLike(blocks)) {
      throw new Error("test model resolver requires authoritative messageBlocks");
    }
    return resolveModelFinalMessages({
      systemMessages: Array.isArray(blocks.system) ? blocks.system : [],
      historyMessages: Array.isArray(blocks.history) ? blocks.history : [],
      incrementalMessages: Array.isArray(blocks.incremental) ? blocks.incremental : [],
    }).messages;
  };
}

export class TestModelMessageRuntimeHelpers {
  createResolveModelMessages() {
    return createTestResolveModelMessages();
  }
}
