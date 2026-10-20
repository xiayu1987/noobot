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
import { text } from "@noobot/shared/value";

async function restoreSnapshotUserAttachmentFacts(engine, identity = {}, messageBlocks = {}) {
  const sessionSource = await engine.session.getSessionContextSource({
    userId: identity.userId,
    sessionId: identity.sessionId,
  });
  return restoreSnapshotUserAttachmentFactsFromSessionAuthority(
    messageBlocks,
    sessionSource?.messages,
  );
}

export async function prepareTurnInput({ attachmentService, buildContextPayload }) {
  const userMessageAttachments = await resolveAttachments({
    attachmentService,
    userMessageAttachments: buildContextPayload.userMessageAttachments,
    userId: text(buildContextPayload.userId),
    sessionId: text(buildContextPayload.sessionId),
  });
  return { userMessageAttachments };
}

export async function prepareAgentTurnExecution(engine, { buildContextPayload }) {
  const payload = buildContextPayload;
  const prepared =
    payload?.runConfig?.resumeFromStoppedSnapshot === true
      ? await prepareStoppedSnapshotResumeTurnExecution(engine, { payload })
      : await engine.agentRuntimeFacade.prepareTurnExecution({
          buildContextPayload: payload,
        });
  const runtimeAttachments = payload.userMessageAttachments;
  const existingSessionAttachments = await engine._resolveExistingUserMessageAttachments({
    userId: text(payload?.userId),
    sessionId: text(payload?.sessionId),
    parentSessionId: text(payload?.parentSessionId),
    turnScopeId: text(payload?.turnScopeId),
    dialogProcessId: text(payload?.dialogProcessId),
  });
  const enrichedRuntimeAttachments = await engine._enrichUserInputAttachmentsFromIndex({
    userId: text(payload?.userId),
    sessionId: text(payload?.sessionId),
    attachments: runtimeAttachments,
    existingAttachments: existingSessionAttachments,
  });
  return {
    ...prepared,
    userMessageAttachments: mapAttachmentRecordsToMetas(enrichedRuntimeAttachments, {
      fallbackMimeType: MIME_TYPE.APPLICATION_OCTET_STREAM,
      userId: text(payload?.userId),
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
  const resumeDialogProcessId = text(runConfig.resumeDialogProcessId);
  const resumeTurnScopeId = text(runConfig.resumeTurnScopeId);
  if (!resumeDialogProcessId || !resumeTurnScopeId) {
    throw new Error("stopped snapshot resume requires resumeDialogProcessId and resumeTurnScopeId");
  }
  return {
    userId: text(payload?.userId),
    sessionId: text(payload?.sessionId),
    parentSessionId: text(payload?.parentSessionId),
    dialogProcessId: resumeDialogProcessId,
    turnScopeId: resumeTurnScopeId,
  };
}

function buildContinuationIdentity(payload) {
  return {
    userName: text(payload?.userName || payload?.userId),
    sessionId: text(payload?.sessionId),
    parentSessionId: text(payload?.parentSessionId),
    dialogProcessId: text(payload?.dialogProcessId),
    parentDialogProcessId: text(payload?.parentDialogProcessId),
    turnScopeId: text(payload?.turnScopeId),
  };
}

function prepareWithoutStoppedSnapshot(engine, { payload }) {
  return engine.agentRuntimeFacade.prepareTurnExecution({
    buildContextPayload: {
      ...payload,
      runConfig: {
        ...payload.runConfig,
        resumeFromStoppedSnapshot: false,
        resumeSnapshotUnavailable: true,
      },
    },
  });
}

function scopeResumedAgentContext(agentContext, runConfig) {
  return {
    ...agentContext,
    bindings: {
      ...agentContext.bindings,
      tools: resolveToolBindings({
        sourceTools: agentContext.bindings.tools,
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

export async function prepareStoppedSnapshotResumeTurnExecution(engine, { payload }) {
  const { contextBuilder, runConfig } = payload;
  const identity = buildStoppedResumeIdentity(payload, runConfig);
  const snapshot = await loadStoppedModelMessageSnapshot({
    globalConfig: engine.globalConfig,
    identity,
    allowMissing: true,
  });
  if (!snapshot) {
    return prepareWithoutStoppedSnapshot(engine, { payload });
  }
  const { userMessageAttachments } = payload;
  const hydratedMessageBlocks = await restoreSnapshotUserAttachmentFacts(
    engine,
    identity,
    readSnapshotMessageBlocks(snapshot),
  );
  const userMetaBackwrites = readArrayOr(snapshot?.userMetaBackwrites);
  const continuedIncrementalMessages = projectSnapshotIncrementalToContinuation(
    hydratedMessageBlocks.incremental,
    buildContinuationIdentity(payload),
  );
  const agentContext = await contextBuilder.buildAgentContext(
    hydratedMessageBlocks.system,
    hydratedMessageBlocks.history,
    {
      dialogProcessId: text(payload?.dialogProcessId || identity.dialogProcessId),
      attachments: userMessageAttachments,
      incrementalMessages: continuedIncrementalMessages,
    },
  );
  const scopedAgentContext = scopeResumedAgentContext(agentContext, runConfig);
  markRuntimeResumedFromSnapshot(getRuntimeFromAgentContext(scopedAgentContext), {
    identity,
    userMetaBackwrites,
    snapshot,
  });
  return {
    agentContext: scopedAgentContext,
    userMessageAttachments,
  };
}
