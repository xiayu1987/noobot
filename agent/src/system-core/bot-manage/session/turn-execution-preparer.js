/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { mapAttachmentRecordsToMetas } from "../../attach/index.js";
import { MIME_TYPE } from "../../constants/index.js";
import { loadStoppedModelMessageSnapshot } from "../../agent/core/resume/model-message-snapshot-store.js";
import { resolveAttachments } from "../../context/providers/attachment-resolver.js";

/**
 * Turn 输入/执行准备族。以 engine 为入参回调其 contextBuilder 构建、
 * agentRuntimeFacade、附件补齐等方法，保持主类薄委托与测试桩兼容。
 */

export async function prepareTurnInput(engine, { buildContextPayload = {} } = {}) {
  const payload = buildContextPayload && typeof buildContextPayload === "object"
    ? buildContextPayload
    : {};
  const contextBuilder = engine._buildContextBuilder(payload);
  const runtimeBasePath = typeof contextBuilder._resolveRuntimeBasePath === "function"
    ? contextBuilder._resolveRuntimeBasePath()
    : await engine._resolveAttachmentIndexBasePath(String(payload.userId || "").trim());
  const effectiveConfig = typeof contextBuilder._getEffectiveConfig === "function"
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

export async function prepareAgentTurnExecution(engine, {
  buildContextPayload = {},
  abortSignal = null,
} = {}) {
  const payload =
    buildContextPayload && typeof buildContextPayload === "object"
      ? buildContextPayload
      : {};
  const contextBuilder =
    payload?.contextBuilder && typeof payload.contextBuilder === "object"
      ? payload.contextBuilder
      : engine._buildContextBuilder(payload);
  const prepared = payload?.runConfig?.resumeFromStoppedSnapshot === true
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
  const runtimeAttachments = Array.isArray(preparedRuntimeAttachments) && preparedRuntimeAttachments.length > 0
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

export async function prepareStoppedSnapshotResumeTurnExecution(engine, {
  payload = {},
  contextBuilder = null,
  abortSignal = null,
} = {}) {
  if (!contextBuilder || typeof contextBuilder._buildAgentContext !== "function") {
    throw new Error("stopped snapshot resume requires a compatible contextBuilder");
  }
  const runConfig = payload?.runConfig && typeof payload.runConfig === "object"
    ? payload.runConfig
    : {};
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
  });
  const userMessageAttachments = await resolveStoppedResumeAttachments(engine, {
    contextBuilder,
    payload,
  });
  // Keep the persisted block boundary: history retains its landed identity,
  // while system/incremental belong to the current resumed execution.
  const systemMessages = Array.isArray(snapshot?.messageBlocks?.system) ? snapshot.messageBlocks.system : [];
  const historyMessages = Array.isArray(snapshot?.messageBlocks?.history) ? snapshot.messageBlocks.history : [];
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
  const resumedSystemMessages = projectRecoveredMessagesToIdentity(systemMessages, currentMessageIdentity, {
    preserveHistoricalRoundIdentity: false,
  });
  const resumedHistoryMessages = projectRecoveredMessagesToIdentity(historyMessages, currentMessageIdentity, {
    preserveHistoricalRoundIdentity: true,
    fillMissingHistoricalRoundIdentity: false,
  });
  const resumedIncrementalMessages = projectRecoveredMessagesToIdentity(incrementalMessages, currentMessageIdentity, {
    preserveHistoricalRoundIdentity: true,
    fillMissingHistoricalRoundIdentity: false,
  });
  const agentContext = await contextBuilder._buildAgentContext(
    resumedSystemMessages,
    [...resumedHistoryMessages, ...resumedIncrementalMessages],
    {
      dialogProcessId: String(payload?.dialogProcessId || identity.dialogProcessId || "").trim(),
      attachments: userMessageAttachments,
    },
  );
  const scopedAgentContext = engine._applyRunConfigToolPolicy(agentContext, runConfig);
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

/**
 * Rebind recovered messages to the current session without destroying their
 * historical turn identity. dialogProcessId and turnScopeId are also used as
 * round/deduplication keys, so replacing them with the current turn would make
 * the restored history look like duplicate incremental input.
 */
export function projectRecoveredMessagesToDialog(messages = [], dialogProcessId = "") {
  return projectRecoveredMessagesToIdentity(messages, { dialogProcessId });
}

export function projectRecoveredMessagesToIdentity(messages = [], identity = {}, {
  preserveHistoricalRoundIdentity = true,
  fillMissingHistoricalRoundIdentity = true,
} = {}) {
  const currentIdentity = Object.fromEntries(
    ["userName", "sessionId", "parentSessionId", "dialogProcessId", "parentDialogProcessId", "turnScopeId"]
      .map((field) => [field, String(identity?.[field] || "").trim()]),
  );
  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (!message || typeof message !== "object") return message;
    for (const field of ["userName", "sessionId", "parentSessionId", "parentDialogProcessId"]) {
      if (currentIdentity[field]) message[field] = currentIdentity[field];
    }
    // Preserve existing historical round keys. For restored snapshot history,
    // absence of dialogProcessId/turnScopeId is meaningful in v2 blocks: adding
    // the current turn identity would make the entire recovered history look
    // like duplicate incremental input and the message builder would drop it.
    const shouldFillMissingRoundIdentity = !preserveHistoricalRoundIdentity || fillMissingHistoricalRoundIdentity;
    if ((!preserveHistoricalRoundIdentity || (shouldFillMissingRoundIdentity && !String(message.dialogProcessId || "").trim())) && currentIdentity.dialogProcessId) {
      message.dialogProcessId = currentIdentity.dialogProcessId;
    }
    if ((!preserveHistoricalRoundIdentity || (shouldFillMissingRoundIdentity && !String(message.turnScopeId || "").trim())) && currentIdentity.turnScopeId) {
      message.turnScopeId = currentIdentity.turnScopeId;
    }
    return message;
  });
}

export async function resolveStoppedResumeAttachments(engine, { contextBuilder = null, payload = {} } = {}) {
  if (!contextBuilder) return [];
  return resolveAttachments({
    attachmentService: contextBuilder.attachmentService,
    runtimeBasePath: typeof contextBuilder._resolveRuntimeBasePath === "function"
      ? contextBuilder._resolveRuntimeBasePath()
      : "",
    effectiveConfig: typeof contextBuilder._getEffectiveConfig === "function"
      ? contextBuilder._getEffectiveConfig()
      : {},
    userMessageAttachments: Array.isArray(payload?.userMessageAttachments)
      ? payload.userMessageAttachments
      : [],
    userId: String(payload?.userId || "").trim(),
    sessionId: String(payload?.sessionId || "").trim(),
  });
}
