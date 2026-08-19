/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createModelContext, resolveModelFinalMessages } from "@noobot/context-protocol";
import { createHookManager } from "@noobot/hook-protocol";
import {
  attachmentTransfer,
  directTransfer,
  TRANSFER_DIRECTION,
} from "@noobot/semantic-transfer-protocol";
import { createModelResponse, MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { migrateHarnessBucket } from "../../src/core/bucket-migration.js";

let testScopeSequence = 0;
let testTransferSequence = 0;
let testModelResponseSequence = 0;

export function createTestModelResponse(
  text,
  {
    reasoning = "",
    toolCalls = [],
    finishReason = "stop",
    usage = {},
    attempts = null,
    identity = {},
  } = {},
) {
  testModelResponseSequence += 1;
  const sequence = testModelResponseSequence;
  const output = {
    text: String(text ?? ""),
    reasoning: String(reasoning ?? ""),
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
    finishReason: String(finishReason ?? ""),
    usage: usage && typeof usage === "object" && !Array.isArray(usage) ? usage : {},
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
      providerId: "test-provider",
      adapterId: "openai-compatible",
      format: "openai_compatible",
    },
  });
}

function initializeTestSemanticTransfer(agentContext = {}) {
  const runtime = agentContext?.bindings?.runtime;
  if (!runtime || typeof runtime !== "object") return;
  const sharedTools =
    runtime.sharedTools && typeof runtime.sharedTools === "object"
      ? runtime.sharedTools
      : (runtime.sharedTools = {});
  if (typeof sharedTools?.semanticTransfer?.transferSemanticContent === "function") return;
  sharedTools.semanticTransfer = {
    async transferSemanticContent(payload = {}) {
      testTransferSequence += 1;
      const identitySource = agentContext?.context?.identity || {};
      const sessionId = String(identitySource.sessionId || "").trim();
      const producer =
        payload?.producer && typeof payload.producer === "object"
          ? payload.producer
          : { type: "plugin", id: "harness-test" };
      const common = {
        transferId: `test-transfer-${testTransferSequence}`,
        messageId: `test-transfer-message-${testTransferSequence}`,
        identity: {
          sessionId,
          turnScopeId: String(identitySource.turnScopeId || "").trim(),
          runId: String(identitySource.runId || "").trim(),
          producer,
        },
        direction: payload.direction || TRANSFER_DIRECTION.OUTPUT,
        intent: {
          source: String(payload.source || producer.type || "plugin").trim(),
          reason: String(payload.reason || payload.strategy || "harness_test_transfer").trim(),
          scenario: String(payload.scenario || "harness").trim(),
          strategy: String(payload.strategy || "harness_summary").trim(),
        },
      };
      if (
        payload.strategy === "harness_summary" &&
        (payload.fullText !== undefined || payload.summaryText !== undefined)
      ) {
        const injectMode = String(payload.injectMode || "full").trim();
        const content =
          injectMode === "summary"
            ? String(payload.summaryText || "")
            : String(payload.fullText || payload.summaryText || "");
        return { transferEnvelopes: [directTransfer({ ...common, content })] };
      }
      const content = String(payload.detail || payload.content || payload.text || "");
      const name = String(payload.name || `harness-test-${testTransferSequence}.md`).trim();
      return {
        transferEnvelopes: [
          attachmentTransfer({
            ...common,
            attachments: [
              {
                identity: {
                  attachmentId: `test-attachment-${testTransferSequence}`,
                  sessionId,
                  attachmentSource: String(payload.attachmentSource || "model").trim(),
                },
                role: "primary",
                name,
                mimeType: String(payload.mimeType || "text/plain").trim(),
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
  if (!ctx || typeof ctx !== "object") return null;
  const agentContext =
    ctx.agentContext && typeof ctx.agentContext === "object" ? ctx.agentContext : null;
  if (!agentContext) return null;
  const bindings =
    agentContext.bindings && typeof agentContext.bindings === "object"
      ? agentContext.bindings
      : (agentContext.bindings = {});
  const legacyRuntime = agentContext?.execution?.controllers?.runtime;
  if (!bindings.runtime || typeof bindings.runtime !== "object") {
    bindings.runtime = legacyRuntime && typeof legacyRuntime === "object" ? legacyRuntime : {};
  }
  if (!Array.isArray(bindings.tools)) {
    bindings.tools = Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];
  }
  const extensions =
    bindings.extensions && typeof bindings.extensions === "object"
      ? bindings.extensions
      : (bindings.extensions = {});
  if (!extensions.harness || typeof extensions.harness !== "object") {
    extensions.harness =
      agentContext?.payload?.harness && typeof agentContext.payload.harness === "object"
        ? agentContext.payload.harness
        : {};
  }
  if (!agentContext.context || typeof agentContext.context !== "object") {
    testScopeSequence += 1;
    const scopeSuffix = String(testScopeSequence);
    const dialogProcessId = String(ctx.dialogProcessId || `test-dialog-${scopeSuffix}`).trim();
    const turnScopeId = String(ctx.turnScopeId || `test-turn:${dialogProcessId}`).trim();
    const sessionId = String(ctx.sessionId || `test-session-${scopeSuffix}`).trim();
    agentContext.context = {
      kind: "noobot.agent-context",
      protocolVersion: 1,
      identity: {
        userId: String(ctx.userId || `test-user-${scopeSuffix}`).trim(),
        sessionId,
        rootSessionId: String(ctx.rootSessionId || sessionId).trim(),
        parentSessionId: String(ctx.parentSessionId || "").trim(),
        dialogProcessId,
        turnScopeId,
        runId: String(ctx.runId || `test-run-${scopeSuffix}`).trim(),
      },
      environment: {},
      execution: {},
      modelContext: null,
    };
  }
  initializeTestSemanticTransfer(agentContext);
  return agentContext;
}

export function ensureTestHookContext(ctx = {}) {
  if (!ctx || typeof ctx !== "object") return ctx;
  const agentContext = ensureTestAgentExecutionScope(ctx);
  const explicitIdentity =
    ctx.activeTurnIdentity && typeof ctx.activeTurnIdentity === "object"
      ? ctx.activeTurnIdentity
      : null;
  const dialogProcessId =
    resolveDialogProcessId(ctx) ||
    String(explicitIdentity?.dialogProcessId || "test-dialog").trim();
  const turnScopeId =
    resolveTurnScopeId(ctx) ||
    String(explicitIdentity?.turnScopeId || `test-turn:${dialogProcessId}`).trim();
  const activeTurnIdentity = { dialogProcessId, turnScopeId };
  const stampRoundIdentity = (messages = []) => {
    for (const message of Array.isArray(messages) ? messages : []) {
      if (!message || typeof message !== "object") continue;
      const role = String(message?.role || message?.type || "")
        .trim()
        .toLowerCase();
      if (role === "system" || role === "developer") continue;
      if (!String(message.dialogProcessId || "").trim()) message.dialogProcessId = dialogProcessId;
      if (!String(message.turnScopeId || "").trim()) message.turnScopeId = turnScopeId;
    }
  };
  stampRoundIdentity(ctx.messages);
  stampRoundIdentity(ctx.messageBlocks?.history);
  stampRoundIdentity(ctx.messageBlocks?.incremental);
  if (ctx.modelContext?.protocolVersion !== 2) {
    const explicitMessageBlocks =
      ctx.messageBlocks ||
      (!ctx.messageStore && !Array.isArray(ctx.messages)
        ? { system: [], history: [], incremental: [] }
        : null);
    ctx.modelContext = createModelContext({
      messages: explicitMessageBlocks ? null : Array.isArray(ctx.messages) ? ctx.messages : null,
      messageBlocks: explicitMessageBlocks,
      activeTurnIdentity,
    });
    ctx.contextProtocolVersion = 2;
  }
  if (!ctx.modelContext.activeTurnIdentity) {
    ctx.modelContext.activeTurnIdentity = activeTurnIdentity;
  }
  if (agentContext?.context) agentContext.context.modelContext = ctx.modelContext;
  delete ctx.messageStore;
  delete ctx.messages;
  delete ctx.messageBlocks;
  delete ctx.activeTurnIdentity;
  migrateHarnessBucket(ctx);
  return ctx;
}

export function createTestModelContext({
  messages = null,
  messageBlocks = null,
  activeTurnIdentity = null,
} = {}) {
  return createModelContext({ messages, messageBlocks, activeTurnIdentity });
}

export function createTestHookContext(ctx = {}, context = {}) {
  return ensureTestHookContext({
    ...ctx,
    messageStore: context.messageStore ?? ctx.messageStore,
    messages: context.messages ?? ctx.messages,
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

function resolveDialogProcessId(ctx = {}) {
  return String(
    ctx?.dialogProcessId || ctx?.agentContext?.context?.identity?.dialogProcessId || "",
  ).trim();
}

function resolveTurnScopeId(ctx = {}) {
  return String(
    ctx?.turnScopeId ||
      ctx?.runtime?.turnScopeId ||
      ctx?.runtime?.systemRuntime?.turnScopeId ||
      ctx?.agentContext?.context?.identity?.turnScopeId ||
      "",
  ).trim();
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

export function createTestResolveModelMessages() {
  return ({ ctx = {} } = {}) => {
    const modelContext = ctx?.modelContext;
    if (modelContext?.protocolVersion !== 2) {
      throw new Error("test model resolver requires modelContext protocolVersion=2");
    }
    const blocks = modelContext.messageBlocks;
    if (!blocks || typeof blocks !== "object") {
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
