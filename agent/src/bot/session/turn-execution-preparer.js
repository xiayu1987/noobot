/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
} from "../../context/agent-context-accessor.js";
import { mapAttachmentRecordsToMetas } from "../../artifacts/index.js";
import { MIME_TYPE } from "@noobot/attachment-protocol/mime";
import { loadStoppedModelMessageSnapshot } from "../../runtime/resume/model-message-snapshot-store.js";
import { resolveAttachments } from "../../context/providers/attachment-resolver.js";
import {
  projectSnapshotIncrementalToContinuation,
  restoreSnapshotUserAttachmentFactsFromSessionAuthority,
} from "@noobot/context-protocol/policy/snapshot";
import { applySystemRuntimeTurnProgress, resolveToolBindings } from "@noobot/agent-config-protocol";

async function restoreSnapshotUserAttachmentFacts(engine, identity = {}, messageBlocks = {}) {
  if (typeof engine?.session?.getSessionContextSource !== "function") {
    throw new Error("stopped snapshot resume requires authoritative Session messages");
  }
  const sessionSource = await engine.session.getSessionContextSource({
    userId: identity.userId,
    sessionId: identity.sessionId,
    parentSessionId: identity.parentSessionId,
  });
  return restoreSnapshotUserAttachmentFactsFromSessionAuthority(
    messageBlocks,
    sessionSource?.messages,
  );
}

export async function prepareTurnInput(engine, { buildContextPayload = {} } = {}) {
  const payload =
    buildContextPayload && typeof buildContextPayload === "object" ? buildContextPayload : {};
  const contextBuilder = engine._buildContextBuilder(payload);
  const runtimeBasePath =
    typeof contextBuilder._resolveRuntimeBasePath === "function"
      ? contextBuilder._resolveRuntimeBasePath()
      : await engine._resolveAttachmentIndexBasePath(String(payload.userId || "").trim());
  const effectiveConfig =
    typeof contextBuilder._getEffectiveConfig === "function"
      ? contextBuilder._getEffectiveConfig()
      : engine.globalConfig;
  const userMessageAttachments = await resolveAttachments({
    attachmentService: contextBuilder.attachmentService || engine.attach,
    runtimeBasePath,
    effectiveConfig,
    userMessageAttachments: Array.isArray(payload.userMessageAttachments)
      ? payload.userMessageAttachments
      : [],
    userId: String(payload.userId || "").trim(),
    sessionId: String(payload.sessionId || "").trim(),
  });
  return { contextBuilder, userMessageAttachments };
}

export async function prepareAgentTurnExecution(
  engine,
  { buildContextPayload = {}, abortSignal = null } = {},
) {
  const payload =
    buildContextPayload && typeof buildContextPayload === "object" ? buildContextPayload : {};
  const contextBuilder =
    payload?.contextBuilder && typeof payload.contextBuilder === "object"
      ? payload.contextBuilder
      : engine._buildContextBuilder(payload);
  const prepared =
    payload?.runConfig?.resumeFromStoppedSnapshot === true
      ? await prepareStoppedSnapshotResumeTurnExecution(engine, {
          payload,
          contextBuilder,
          abortSignal,
        })
      : await engine.agentRuntimeFacade.prepareTurnExecution({
          buildContextPayload: {
            ...payload,
            contextBuilder,
          },
          abortSignal,
        });
  const preparedRuntime = getRuntimeFromAgentContext(prepared?.agentContext || {});
  const preparedRuntimeAttachments = Array.isArray(preparedRuntime?.userMessageAttachments)
    ? preparedRuntime.userMessageAttachments
    : null;
  const payloadUserMessageAttachments = Array.isArray(payload?.userMessageAttachments)
    ? payload.userMessageAttachments
    : [];
  const runtimeAttachments =
    Array.isArray(preparedRuntimeAttachments) && preparedRuntimeAttachments.length > 0
      ? preparedRuntimeAttachments
      : payloadUserMessageAttachments;
  const existingSessionAttachments = await engine._resolveExistingUserMessageAttachments({
    userId: String(payload?.userId || "").trim(),
    sessionId: String(payload?.sessionId || "").trim(),
    parentSessionId: String(payload?.parentSessionId || "").trim(),
    turnScopeId: String(payload?.turnScopeId || payload?.runConfig?.turnScopeId || "").trim(),
    dialogProcessId: String(payload?.dialogProcessId || "").trim(),
  });
  const enrichedRuntimeAttachments = await engine._enrichUserInputAttachmentsFromIndex({
    userId: String(payload?.userId || "").trim(),
    sessionId: String(payload?.sessionId || "").trim(),
    attachments: runtimeAttachments,
    existingAttachments: existingSessionAttachments,
  });
  return {
    ...(prepared && typeof prepared === "object" ? prepared : {}),
    userMessageAttachments: mapAttachmentRecordsToMetas(enrichedRuntimeAttachments, {
      fallbackMimeType: MIME_TYPE.APPLICATION_OCTET_STREAM,
      userId: String(payload?.userId || "").trim(),
    }),
  };
}

function readArrayOr(value) {
  return Array.isArray(value) ? value : [];
}

function readSnapshotMessageBlocks(snapshot) {
  return {
    system: readArrayOr(snapshot?.messageBlocks?.system),
    history: readArrayOr(snapshot?.messageBlocks?.history),
    incremental: readArrayOr(snapshot?.messageBlocks?.incremental),
  };
}

function buildStoppedResumeIdentity(payload, runConfig) {
  const resumeDialogProcessId = String(runConfig.resumeDialogProcessId || "").trim();
  const resumeTurnScopeId = String(runConfig.resumeTurnScopeId || "").trim();
  if (!resumeDialogProcessId || !resumeTurnScopeId) {
    throw new Error("stopped snapshot resume requires resumeDialogProcessId and resumeTurnScopeId");
  }
  return {
    userId: String(payload?.userId || "").trim(),
    sessionId: String(payload?.sessionId || "").trim(),
    parentSessionId: String(payload?.parentSessionId || "").trim(),
    dialogProcessId: resumeDialogProcessId,
    turnScopeId: resumeTurnScopeId,
  };
}

function buildContinuationIdentity(payload, runConfig) {
  return {
    userName: String(payload?.userName || payload?.userId || "").trim(),
    sessionId: String(payload?.sessionId || "").trim(),
    parentSessionId: String(payload?.parentSessionId || "").trim(),
    dialogProcessId: String(payload?.dialogProcessId || "").trim(),
    parentDialogProcessId: String(payload?.parentDialogProcessId || "").trim(),
    turnScopeId: String(payload?.turnScopeId || runConfig?.turnScopeId || "").trim(),
  };
}

function prepareWithoutStoppedSnapshot(
  engine,
  { payload, contextBuilder, runConfig, abortSignal },
) {
  return engine.agentRuntimeFacade.prepareTurnExecution({
    buildContextPayload: {
      ...payload,
      contextBuilder,
      runConfig: {
        ...runConfig,
        resumeFromStoppedSnapshot: false,
        resumeSnapshotUnavailable: true,
      },
    },
    abortSignal,
  });
}

function scopeResumedAgentContext(agentContext, userMetaBackwrites, runConfig) {
  return {
    ...agentContext,
    context: {
      ...(agentContext?.context || {}),
      modelContext: {
        ...(agentContext?.context?.modelContext || {}),
        userMetaBackwrites,
      },
    },
    bindings: {
      ...(agentContext?.bindings || {}),
      tools: resolveToolBindings({
        sourceTools: agentContext?.bindings?.tools,
        runConfig,
      }),
    },
  };
}

function markRuntimeResumedFromSnapshot(runtime, { identity, userMetaBackwrites, snapshot }) {
  runtime.userMetaBackwrites = userMetaBackwrites;
  runtime.resumeFromStoppedSnapshot = true;
  runtime.resumedStoppedSnapshotIdentity = identity;
  runtime.resumedStoppedSnapshotTurnProgress = applySystemRuntimeTurnProgress(
    getSystemRuntimeFromRuntime(runtime),
    snapshot?.turnProgress,
  );
}

export async function prepareStoppedSnapshotResumeTurnExecution(
  engine,
  { payload = {}, contextBuilder = null, abortSignal = null } = {},
) {
  if (!contextBuilder || typeof contextBuilder.buildAgentContext !== "function") {
    throw new Error("stopped snapshot resume requires a compatible contextBuilder");
  }
  const runConfig =
    payload?.runConfig && typeof payload.runConfig === "object" ? payload.runConfig : {};
  const identity = buildStoppedResumeIdentity(payload, runConfig);
  const snapshot = await loadStoppedModelMessageSnapshot({
    globalConfig: engine.globalConfig,
    identity,
    allowMissing: true,
  });
  if (!snapshot) {
    return prepareWithoutStoppedSnapshot(engine, {
      payload,
      contextBuilder,
      runConfig,
      abortSignal,
    });
  }
  const userMessageAttachments = await resolveStoppedResumeAttachments(engine, {
    contextBuilder,
    payload,
  });
  const hydratedMessageBlocks = await restoreSnapshotUserAttachmentFacts(
    engine,
    identity,
    readSnapshotMessageBlocks(snapshot),
  );
  const userMetaBackwrites = readArrayOr(snapshot?.userMetaBackwrites);
  const continuedIncrementalMessages = projectSnapshotIncrementalToContinuation(
    hydratedMessageBlocks.incremental,
    buildContinuationIdentity(payload, runConfig),
  );
  const agentContext = await contextBuilder.buildAgentContext(
    hydratedMessageBlocks.system,
    hydratedMessageBlocks.history,
    {
      dialogProcessId: String(payload?.dialogProcessId || identity.dialogProcessId || "").trim(),
      attachments: userMessageAttachments,
      incrementalMessages: continuedIncrementalMessages,
    },
  );
  const scopedAgentContext = scopeResumedAgentContext(agentContext, userMetaBackwrites, runConfig);
  const runtimeAgentContext = engine.agentRuntimeFacade.buildRunTurnContext(
    scopedAgentContext,
    abortSignal,
  );
  markRuntimeResumedFromSnapshot(getRuntimeFromAgentContext(runtimeAgentContext), {
    identity,
    userMetaBackwrites,
    snapshot,
  });
  return {
    agentContext: scopedAgentContext,
    runtimeAgentContext,
    userMessageAttachments,
  };
}

export async function resolveStoppedResumeAttachments(
  engine,
  { contextBuilder = null, payload = {} } = {},
) {
  if (!contextBuilder) return [];
  return resolveAttachments({
    attachmentService: contextBuilder.attachmentService,
    runtimeBasePath:
      typeof contextBuilder._resolveRuntimeBasePath === "function"
        ? contextBuilder._resolveRuntimeBasePath()
        : "",
    effectiveConfig:
      typeof contextBuilder._getEffectiveConfig === "function"
        ? contextBuilder._getEffectiveConfig()
        : {},
    userMessageAttachments: Array.isArray(payload?.userMessageAttachments)
      ? payload.userMessageAttachments
      : [],
    userId: String(payload?.userId || "").trim(),
    sessionId: String(payload?.sessionId || "").trim(),
  });
}
