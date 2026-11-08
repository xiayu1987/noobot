/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { canonicalizeTestContextMessage } from "./context-message.js";
import {
  attachModelContext,
  createModelContext,
  requireAuthoritativeModelContext,
  resolveModelFinalMessages,
} from "@noobot/context-protocol";
import {
  assertMainFlowControlPort,
  createSummaryCheckpointInstruction,
} from "@noobot/context-protocol/policy/main-flow-control";
import {
  createHookManager,
  createHookRuntimeIdentity,
  HOOK_PROTOCOL_VERSION,
} from "@noobot/hook-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  attachmentTransfer,
  directTransfer,
  TRANSFER_DIRECTION,
} from "@noobot/semantic-transfer-protocol";
import { createModelResponse, MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { migrateHarnessBucket } from "../../src/core/bucket-migration.js";
import { HARNESS_PLANNING_GUIDANCE_MODE } from "../../src/core/constants.js";
import { normalizeOptions } from "../../src/core/options.js";

import { text, isObjectLike } from "@noobot/shared/value";
let testScopeSequence = 0;
let testTransferSequence = 0;
let testModelResponseSequence = 0;

export function createTestModelResponse(
  outputText = "",
  {
    reasoning = "",
    toolCalls = [],
    finishReason = "stop",
    content = undefined,
    responseOutput = undefined,
    responseReasoning = undefined,
    attempts,
    identity = {},
  } = {},
) {
  testModelResponseSequence += 1;
  const sequence = testModelResponseSequence;
  const output = {
    text: outputText,
    reasoning,
    toolCalls,
    finishReason,
    ...(content !== undefined ? { content } : {}),
    ...(responseOutput !== undefined ? { responseOutput } : {}),
    ...(responseReasoning !== undefined ? { responseReasoning } : {}),
  };
  const normalizedAttempts =
    attempts === undefined
      ? [{ attempt: 1, status: "completed", kind: "response", streaming: false, output }]
      : attempts;
  const {
    sessionId = `test-model-session-${sequence}`,
    parentSessionId = "",
    dialogProcessId = `test-model-dialog-${sequence}`,
    turnScopeId = `test-model-turn-${sequence}`,
    runId = `test-model-run-${sequence}`,
  } = identity;
  return {
    toolNameBindings: {},
    ...createModelResponse({
      invocation: {
        requestId: `test-model-request-${sequence}`,
        invocationId: `test-model-invocation-${sequence}`,
        sessionId,
        parentSessionId,
        dialogProcessId,
        turnScopeId,
        runId,
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
    }),
  };
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
        presentationMessageId: `test-transfer-message-${testTransferSequence}`,
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

const testMainFlowControlRecords = new WeakMap();

export function createTestMainFlowControlPort() {
  const record = { summaryCheckpoints: [], finalNoToolsTurnEngaged: false };
  const port = assertMainFlowControlPort({
    requestSummaryCheckpoint(input) {
      const instruction = createSummaryCheckpointInstruction(input);
      record.summaryCheckpoints.push(instruction);
      return instruction;
    },
    isFinalNoToolsTurnEngaged: () => record.finalNoToolsTurnEngaged,
  });
  testMainFlowControlRecords.set(port, record);
  return port;
}

export function readTestMainFlowControl(agentContext) {
  const record = testMainFlowControlRecords.get(agentContext.bindings.mainFlowControl);
  if (!record) throw new TypeError("agentContext has no test main flow control port");
  return record;
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

    const sources = [ctx, ctx.activeTurnIdentity, systemRuntime];
    const dialogProcessId = resolveTestIdentityField(
      sources,
      "dialogProcessId",
      `test-dialog-${scopeSuffix}`,
    );
    const sessionId = resolveTestIdentityField(sources, "sessionId", `test-session-${scopeSuffix}`);
    agentContext.context = {
      kind: "noobot.agent-context",
      protocolVersion: 1,
      identity: {
        userId: resolveTestIdentityField(sources, "userId", `test-user-${scopeSuffix}`),
        sessionId,
        rootSessionId: resolveTestIdentityField([ctx], "rootSessionId", sessionId),
        parentSessionId: resolveTestIdentityField(sources, "parentSessionId", ""),
        dialogProcessId,
        turnScopeId: resolveTestIdentityField(
          sources,
          "turnScopeId",
          `test-turn:${dialogProcessId}`,
        ),
        runId: resolveTestIdentityField([ctx], "runId", `test-run-${scopeSuffix}`),
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
  bindings.mainFlowControl = testMainFlowControlRecords.has(bindings.mainFlowControl)
    ? bindings.mainFlowControl
    : createTestMainFlowControlPort();
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
  if (ctx.modelResponse) ctx.modelResponse = { toolNameBindings: {}, ...ctx.modelResponse };
  if (!Object.hasOwn(ctx, "turn")) ctx.turn = 1;
  ensureTestAgentExecutionScope(ctx);
  const explicitIdentity =
    ctx.activeTurnIdentity && typeof ctx.activeTurnIdentity === "object"
      ? ctx.activeTurnIdentity
      : null;
  const identitySources = [ctx, explicitIdentity, ctx.agentContext?.context?.identity];
  const dialogProcessId = resolveTestIdentityField(
    identitySources,
    "dialogProcessId",
    "test-dialog",
  );
  const turnScopeId = resolveTestIdentityField(
    identitySources,
    "turnScopeId",
    `test-turn:${dialogProcessId}`,
  );
  const activeTurnIdentity = { dialogProcessId, turnScopeId };
  const stampRoundIdentity = (messages = []) => {
    for (const message of Array.isArray(messages) ? messages : []) {
      if (!isObjectLike(message)) continue;
      const role = String(message?.role || message?.type || "")
        .trim()
        .toLowerCase();
      canonicalizeTestContextMessage(message);
      if (role === "system" || role === "developer") continue;
      const metadata = message.additional_kwargs;
      if (!Object.hasOwn(metadata, "dialogProcessId")) metadata.dialogProcessId = dialogProcessId;
      if (!Object.hasOwn(metadata, "turnScopeId")) metadata.turnScopeId = turnScopeId;
    }
  };
  stampRoundIdentity(ctx.messageBlocks?.system);
  stampRoundIdentity(ctx.messageBlocks?.history);
  stampRoundIdentity(ctx.messageBlocks?.incremental);
  if (!Object.hasOwn(ctx, "modelContext")) {
    attachModelContext(
      ctx,
      createModelContext({
        messageBlocks: ctx.messageBlocks ?? { system: [], history: [], incremental: [] },
        activeTurnIdentity,
      }),
    );
  }
  requireAuthoritativeModelContext(ctx);
  delete ctx.messageBlocks;
  delete ctx.activeTurnIdentity;
  injectTestHookRuntimeIdentity(ctx, identitySources, activeTurnIdentity);
  migrateHarnessBucket(ctx);
  return ctx;
}

function resolveTestIdentityField(sources, field, hostDefault) {
  const declared = [
    ...new Set(
      sources
        .filter((source) => source && source[field] !== undefined)
        .map((source) => source[field]),
    ),
  ];
  if (declared.length > 1) {
    throw new Error(
      `test hook identity ${field} is declared inconsistently: ${declared.join(" | ")}`,
    );
  }
  return declared.length ? declared[0] : hostDefault;
}

function injectTestHookRuntimeIdentity(ctx, sources, activeTurnIdentity) {
  const identity = createHookRuntimeIdentity({
    userId: resolveTestIdentityField(sources, "userId", "test-user"),
    sessionId: resolveTestIdentityField(sources, "sessionId", "test-session"),
    parentSessionId: resolveTestIdentityField(sources, "parentSessionId", ""),
    dialogProcessId: activeTurnIdentity.dialogProcessId,
    turnScopeId: activeTurnIdentity.turnScopeId,
    caller: resolveTestIdentityField([ctx], "caller", SESSION_CALLER.USER),
  });
  Object.assign(ctx, identity);
}

export function createTestHookContext(ctx = {}, context = {}) {
  return ensureTestHookContext({
    ...ctx,
    messageBlocks: context.messageBlocks ?? ctx.messageBlocks,
    activeTurnIdentity: context.activeTurnIdentity ?? ctx.activeTurnIdentity,
  });
}

export function getTestContextMessages(ctx) {
  return requireAuthoritativeModelContext(ctx).messages;
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

export function createTestHarnessMeta(harness = {}) {
  return {
    harness: {
      ...normalizeOptions({ planningGuidanceMode: HARNESS_PLANNING_GUIDANCE_MODE.INJECT }),
      ...harness,
    },
  };
}

export function createTestResolveModelMessages() {
  return ({ ctx = {} } = {}) => {
    const { messageBlocks: blocks } = requireAuthoritativeModelContext(ctx);
    return resolveModelFinalMessages({
      systemMessages: blocks.system,
      historyMessages: blocks.history,
      incrementalMessages: blocks.incremental,
    }).messages;
  };
}

export class TestModelMessageRuntimeHelpers {
  createResolveModelMessages() {
    return createTestResolveModelMessages();
  }
}
