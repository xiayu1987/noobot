/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { mapAttachmentRecordsToMetas } from "../../artifacts/index.js";
import { MIME_TYPE } from "../../shared/constants/index.js";
import { loadStoppedModelMessageSnapshot } from "../../runtime/resume/model-message-snapshot-store.js";
import { resolveAttachments } from "../../context/providers/attachment-resolver.js";
import { projectRecoveredMessagesToIdentity } from "@noobot/context-protocol/snapshot-policy";
import { resolveToolBindings } from "@noobot/agent-config-protocol";

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

export async function prepareStoppedSnapshotResumeTurnExecution(
  engine,
  { payload = {}, contextBuilder = null, abortSignal = null } = {},
) {
  if (!contextBuilder || typeof contextBuilder._buildAgentContext !== "function") {
    throw new Error("stopped snapshot resume requires a compatible contextBuilder");
  }
  const runConfig =
    payload?.runConfig && typeof payload.runConfig === "object" ? payload.runConfig : {};
  const resumeDialogProcessId = String(runConfig.resumeDialogProcessId || "").trim();
  const resumeTurnScopeId = String(runConfig.resumeTurnScopeId || "").trim();
  if (!resumeDialogProcessId || !resumeTurnScopeId) {
    throw new Error("stopped snapshot resume requires resumeDialogProcessId and resumeTurnScopeId");
  }
  const identity = {
    userId: String(payload?.userId || "").trim(),
    sessionId: String(payload?.sessionId || "").trim(),
    parentSessionId: String(payload?.parentSessionId || "").trim(),
    dialogProcessId: resumeDialogProcessId,
    turnScopeId: resumeTurnScopeId,
  };
  const snapshot = await loadStoppedModelMessageSnapshot({
    globalConfig: engine.globalConfig,
    identity,
    allowMissing: true,
  });
  if (!snapshot) {
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
  const userMessageAttachments = await resolveStoppedResumeAttachments(engine, {
    contextBuilder,
    payload,
  });
  const systemMessages = Array.isArray(snapshot?.messageBlocks?.system)
    ? snapshot.messageBlocks.system
    : [];
  const historyMessages = Array.isArray(snapshot?.messageBlocks?.history)
    ? snapshot.messageBlocks.history
    : [];
  const incrementalMessages = Array.isArray(snapshot?.messageBlocks?.incremental)
    ? snapshot.messageBlocks.incremental
    : [];
  const currentMessageIdentity = {
    userName: String(payload?.userName || payload?.userId || "").trim(),
    sessionId: String(payload?.sessionId || "").trim(),
    parentSessionId: String(payload?.parentSessionId || "").trim(),
    dialogProcessId: String(payload?.dialogProcessId || "").trim(),
    parentDialogProcessId: String(payload?.parentDialogProcessId || "").trim(),
    turnScopeId: String(payload?.turnScopeId || runConfig?.turnScopeId || "").trim(),
  };
  const resumedHistoryMessages = projectRecoveredMessagesToIdentity(
    historyMessages,
    currentMessageIdentity,
  );
  const resumedIncrementalMessages = projectRecoveredMessagesToIdentity(
    incrementalMessages,
    currentMessageIdentity,
  );
  const agentContext = await contextBuilder._buildAgentContext(
    systemMessages,
    resumedHistoryMessages,
    {
      dialogProcessId: String(payload?.dialogProcessId || identity.dialogProcessId || "").trim(),
      attachments: userMessageAttachments,
      incrementalMessages: resumedIncrementalMessages,
    },
  );
  const scopedAgentContext = {
    ...agentContext,
    bindings: {
      ...(agentContext?.bindings || {}),
      tools: resolveToolBindings({
        sourceTools: agentContext?.bindings?.tools,
        runConfig,
      }),
    },
  };
  const runtimeAgentContext = engine.agentRuntimeFacade.buildRunTurnContext(
    scopedAgentContext,
    abortSignal,
  );
  const runtime = getRuntimeFromAgentContext(runtimeAgentContext);
  runtime.resumeFromStoppedSnapshot = true;
  runtime.resumedStoppedSnapshotIdentity = identity;
  return {
    agentContext: scopedAgentContext,
    runtimeAgentContext,
    userMessageAttachments,
  };
}

export { projectRecoveredMessagesToIdentity };

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
