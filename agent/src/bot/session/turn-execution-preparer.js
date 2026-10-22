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
import { loadStoppedModelMessageSnapshot } from "../../runtime/resume/model-message-snapshot-store.js";
import { resolveAttachments } from "../../context/providers/attachment-resolver.js";
import {
  projectSnapshotIncrementalToContinuation,
  restoreSnapshotUserAttachmentFactsFromSessionAuthority,
} from "@noobot/context-protocol/policy/snapshot";
import { applySystemRuntimeTurnProgress, resolveToolBindings } from "@noobot/agent-config-protocol";
import { text } from "@noobot/shared/value";
import { enrichUserInputAttachmentsFromIndex } from "./turn-attachment-enricher.js";

export async function prepareTurnInput({ attachmentService, buildContextPayload }) {
  const userMessageAttachments = await resolveAttachments({
    attachmentService,
    userMessageAttachments: buildContextPayload.userMessageAttachments,
    userId: buildContextPayload.userId,
    sessionId: buildContextPayload.sessionId,
  });
  return { userMessageAttachments };
}

export async function prepareAgentTurnExecution(engine, { buildContextPayload: payload }) {
  const prepared =
    payload.runConfig.resumeFromStoppedSnapshot === true
      ? await prepareStoppedSnapshotResumeTurnExecution(engine, { payload })
      : await engine.agentRuntimeFacade.prepareTurnExecution({ buildContextPayload: payload });
  const enrichedAttachments = await enrichUserInputAttachmentsFromIndex(engine.workspaceService, {
    userId: payload.userId,
    sessionId: payload.sessionId,
    attachments: payload.userMessageAttachments,
  });
  return {
    ...prepared,
    userMessageAttachments: mapAttachmentRecordsToMetas(enrichedAttachments),
  };
}

function buildStoppedResumeIdentity(payload) {
  const resumeDialogProcessId = text(payload.runConfig.resumeDialogProcessId);
  const resumeTurnScopeId = text(payload.runConfig.resumeTurnScopeId);
  if (!resumeDialogProcessId || !resumeTurnScopeId) {
    throw new Error("stopped snapshot resume requires resumeDialogProcessId and resumeTurnScopeId");
  }
  return {
    userId: payload.userId,
    sessionId: payload.sessionId,
    parentSessionId: payload.parentSessionId,
    dialogProcessId: resumeDialogProcessId,
    turnScopeId: resumeTurnScopeId,
  };
}

async function restoreSnapshotUserAttachmentFacts(engine, payload, messageBlocks) {
  const sessionSource = await engine.session.getSessionContextSource({
    userId: payload.userId,
    sessionId: payload.sessionId,
    persistenceScope: payload.persistenceScope,
  });
  return restoreSnapshotUserAttachmentFactsFromSessionAuthority(
    messageBlocks,
    sessionSource.messages,
  );
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

function markRuntimeResumedFromSnapshot(runtime, { identity, snapshot }) {
  runtime.resumeFromStoppedSnapshot = true;
  runtime.resumedStoppedSnapshotIdentity = identity;
  runtime.resumedStoppedSnapshotTurnProgress = applySystemRuntimeTurnProgress(
    getSystemRuntimeFromRuntime(runtime),
    snapshot.turnProgress,
  );
}

export async function prepareStoppedSnapshotResumeTurnExecution(engine, { payload }) {
  const identity = buildStoppedResumeIdentity(payload);
  const snapshot = await loadStoppedModelMessageSnapshot({
    globalConfig: engine.globalConfig,
    identity,
    allowMissing: true,
  });
  if (!snapshot) {
    return prepareWithoutStoppedSnapshot(engine, { payload });
  }
  const hydratedMessageBlocks = await restoreSnapshotUserAttachmentFacts(
    engine,
    payload,
    snapshot.messageBlocks,
  );
  const continuedIncrementalMessages = projectSnapshotIncrementalToContinuation(
    hydratedMessageBlocks.incremental,
    { dialogProcessId: payload.dialogProcessId, turnScopeId: payload.turnScopeId },
  );
  const agentContext = await payload.contextBuilder.buildAgentContext(
    hydratedMessageBlocks.system,
    hydratedMessageBlocks.history,
    {
      dialogProcessId: payload.dialogProcessId,
      attachments: payload.userMessageAttachments,
      incrementalMessages: continuedIncrementalMessages,
      userMetaBackwrites: snapshot.userMetaBackwrites,
    },
  );
  const scopedAgentContext = scopeResumedAgentContext(agentContext, payload.runConfig);
  markRuntimeResumedFromSnapshot(getRuntimeFromAgentContext(scopedAgentContext), {
    identity,
    snapshot,
  });
  return {
    agentContext: scopedAgentContext,
    userMessageAttachments: payload.userMessageAttachments,
  };
}
