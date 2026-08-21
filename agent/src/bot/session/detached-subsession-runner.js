/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent } from "../../events/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { CALLER_ROLE } from "../config/constants.js";
import { TURN_EVENT, TURN_PHASE, createTurnAcceptanceReceipt } from "@noobot/session-protocol";
import { normalizeTrimmedStringList } from "./session-execution-engine-utils.js";
import { readSelectedModelValue } from "../execution/runner/debug-utils.js";
import {
  createDetachedTerminalReceipt,
  createScopedSubSessionEventListener,
} from "./detached-subsession-events.js";

export { createDetachedTerminalReceipt, createScopedSubSessionEventListener };

async function transferCanonicalAttachmentsToSubSession({
  attachmentService = null,
  userId = "",
  parentSessionId = "",
  subSessionId = "",
  attachments = [],
  attachmentPolicy = {},
} = {}) {
  const source = Array.isArray(attachments) ? attachments : [];
  if (!source.length) return [];
  const output = [];
  for (const attachment of source) {
    output.push(
      await transferCanonicalAttachment({
        attachmentService,
        userId,
        parentSessionId,
        subSessionId,
        attachment,
        attachmentPolicy,
      }),
    );
  }
  return output;
}

async function transferCanonicalAttachment({
  attachmentService,
  userId,
  parentSessionId,
  subSessionId,
  attachment,
  attachmentPolicy,
}) {
  const attachmentId = String(attachment?.attachmentId || "").trim();
  const path = String(attachment?.path || "").trim();
  if (!attachmentId || !path) return attachment;
  const attachmentSessionId = String(attachment?.sessionId || "").trim();
  if (attachmentSessionId === subSessionId) return attachment;
  assertParentAttachmentOwnership(attachmentSessionId, parentSessionId);
  assertCanonicalAttachmentService(attachmentService);
  const attachmentSource = String(attachment?.attachmentSource || "user").trim() || "user";
  const parentRecord = await attachmentService.getAttachmentById({
    userId,
    attachmentId,
    sessionId: parentSessionId,
    attachmentSource,
  });
  assertParentAttachmentRecord(parentRecord);
  const sourceContent = await attachmentService.readAttachmentContent({
    userId,
    attachmentId,
    sessionId: parentSessionId,
    attachmentSource,
  });
  assertParentAttachmentContent(sourceContent);
  const [transferred] = await attachmentService.ingest({
    userId,
    sessionId: subSessionId,
    attachmentSource: "user",
    attachmentPolicy:
      attachmentPolicy && typeof attachmentPolicy === "object" ? attachmentPolicy : {},
    attachments: [
      createTransferredAttachment(attachment, parentRecord, sourceContent, attachmentId),
    ],
  });
  if (!transferred || String(transferred?.sessionId || "").trim() !== subSessionId) {
    throw new Error("detached sub-session attachment transfer did not create child ownership");
  }
  return transferred;
}

function assertParentAttachmentOwnership(attachmentSessionId, parentSessionId) {
  if (attachmentSessionId === parentSessionId) return;
  throw new Error("detached sub-session attachment must belong to its parent session");
}

function assertParentAttachmentRecord(parentRecord) {
  if (parentRecord) return;
  throw new Error("detached sub-session source attachment does not exist in its parent session");
}

function assertParentAttachmentContent(sourceContent) {
  if (sourceContent?.content) return;
  throw new Error("detached sub-session source attachment content is unavailable");
}

function assertCanonicalAttachmentService(attachmentService) {
  const requiredMethods = ["getAttachmentById", "readAttachmentContent", "ingest"];
  if (requiredMethods.every((method) => typeof attachmentService?.[method] === "function")) return;
  throw new Error("detached sub-session canonical attachment transfer requires AttachmentService");
}

function createTransferredAttachment(attachment, parentRecord, sourceContent, attachmentId) {
  return {
    clientAttachmentId: String(
      attachment?.clientAttachmentId || `session-transfer:${attachmentId}`,
    ).trim(),
    name: String(parentRecord?.name || attachment?.name || "attachment").trim(),
    mimeType: String(
      parentRecord?.mimeType || attachment?.mimeType || "application/octet-stream",
    ).trim(),
    contentBase64: sourceContent.content.toString("base64"),
    ...(typeof attachment?.isSandbox === "boolean" ? { isSandbox: attachment.isSandbox } : {}),
  };
}

function assertDetachedSubSessionStrategy(strategy = {}) {
  const required = [
    "sessionId",
    "dialogProcessId",
    "turnScopeId",
    "executionId",
    "relativeDir",
    "allowedRoot",
  ];
  if (required.some((key) => !String(strategy?.[key] || "").trim())) {
    throw new TypeError(
      "detached sub-session strategy requires sessionId, dialogProcessId, turnScopeId, executionId, relativeDir and allowedRoot",
    );
  }
}

export function createDetachedSubSessionRunner({
  workspaceService = null,
  configService = null,
  sessionRunner = null,
  session = null,
  attachmentService = null,
  mergeRunConfigPluginPolicy = null,
  prepareRunConfig = null,
  now = () => new Date().toISOString(),
} = {}) {
  const dependencies = {
    workspaceService,
    configService,
    sessionRunner,
    session,
    attachmentService,
    mergeRunConfigPluginPolicy,
    prepareRunConfig,
    now,
  };
  return (request = {}) => runDetachedSubSession(dependencies, request);
}

async function runDetachedSubSession(dependencies, request) {
  assertDetachedRunnerDependencies(dependencies);
  const runtime = resolveDetachedRuntime(request);
  const identity = resolveDetachedIdentity(request, runtime);
  const prepared = await prepareDetachedExecution(dependencies, request, runtime, identity);
  const lifecycle = await createDetachedLifecycle(dependencies, request, identity, prepared);
  const accepted = await commitDetachedStart(
    lifecycle,
    prepared.effectiveRunConfig.thinkingStartedAt,
    request,
    identity,
    prepared.effectiveRunConfig,
  );
  prepared.turnAcceptance = accepted.userMessage
    ? createTurnAcceptanceReceipt({
        commandId: lifecycle.commandId,
        sessionId: identity.subSessionId,
        turnScopeId: identity.turnScopeId,
        dialogProcessId: accepted.dialogProcessId || identity.subDialogProcessId,
        messageUid: accepted.userMessage.messageUid,
        aggregateVersion: accepted.aggregateVersion,
        committedEventPublished: false,
      })
    : null;
  let result;
  try {
    result = await executeDetachedSession(
      dependencies,
      request,
      runtime,
      identity,
      prepared,
      lifecycle,
    );
  } catch (error) {
    await commitDetachedError(error, dependencies, request, runtime, identity, lifecycle);
    throw error;
  }
  const terminalLifecycle = await commitDetachedCompletion(dependencies, lifecycle);
  return projectDetachedResult(result, identity, prepared, terminalLifecycle);
}

function assertDetachedRunnerDependencies({ sessionRunner, session }) {
  if (typeof sessionRunner?.runSession !== "function") {
    throw new Error("detached sub-session runner requires the main SessionExecutionRunner");
  }
  if (typeof session?.createScopedPersistenceContext !== "function") {
    throw new Error("detached sub-session runner requires scoped persistence context support");
  }
}

function resolveDetachedRuntime(request) {
  const {
    parentExecutionScope,
    eventListener,
    strategy = {},
    parentContext = {},
    metadata = {},
  } = request;
  try {
    return getRuntimeFromAgentContext(parentExecutionScope);
  } catch (error) {
    emitEvent(eventListener, "detached_sub_session_scope_rejected", {
      userId: String(strategy.userId || parentContext?.userId || "").trim(),
      parentSessionId: String(strategy.parentSessionId || parentContext?.sessionId || "").trim(),
      scopeId: String(metadata.scope || "detached_sub_session").trim(),
      reason: "bindings.runtime_missing",
      error: error?.message || String(error),
    });
    throw error;
  }
}

function resolveDetachedIdentity(request, inheritedRuntime) {
  const sourceContext =
    request.parentContext && typeof request.parentContext === "object" ? request.parentContext : {};
  const strategy = request.strategy || {};
  const identity = {
    userId: String(strategy.userId || sourceContext.userId || "").trim(),
    parentSessionId: String(strategy.parentSessionId || sourceContext.sessionId || "").trim(),
    parentDialogProcessId: String(
      strategy.parentDialogProcessId || sourceContext.dialogProcessId || "",
    ).trim(),
  };
  identity.abortSignal =
    request.abortSignal || sourceContext.abortSignal || inheritedRuntime?.abortSignal || null;
  identity.userInteractionBridge =
    sourceContext.userInteractionBridge || inheritedRuntime?.userInteractionBridge || null;
  createAbortGuard(identity.abortSignal)();
  if (!identity.userId || !identity.parentSessionId) {
    throw new Error("sub-session runner requires userId and parentSessionId");
  }
  assertDetachedSubSessionStrategy(strategy);
  Object.assign(identity, resolveChildStrategyIdentity(strategy));
  identity.scopedEventListener = createScopedSubSessionEventListener(request.eventListener, {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    dialogProcessId: identity.subDialogProcessId || identity.subSessionId,
    turnScopeId: identity.turnScopeId,
  });
  return identity;
}

function resolveChildStrategyIdentity(strategy) {
  return {
    subSessionId: String(strategy.sessionId || "").trim(),
    subDialogProcessId: String(strategy.dialogProcessId || "").trim(),
    turnScopeId: String(strategy.turnScopeId || "").trim(),
    executionId: String(strategy.executionId || "").trim(),
    relativeDir: String(strategy.relativeDir || "").trim(),
    allowedRoot: String(strategy.allowedRoot || "").trim(),
  };
}

async function prepareDetachedExecution(dependencies, request, inheritedRuntime, identity) {
  const { strategy = {}, metadata = {}, runConfigPatch = {}, parentContext = {} } = request;
  const inheritedRunConfig = clearParentTurnTransactionIdentity({
    ...(isObjectRecord(parentContext.runConfig)
      ? parentContext.runConfig
      : isObjectRecord(inheritedRuntime?.runConfig)
        ? inheritedRuntime.runConfig
        : {}),
  });
  const mergedRunConfig = createDetachedRunConfig(
    dependencies,
    { strategy, metadata, runConfigPatch },
    inheritedRunConfig,
    inheritedRuntime,
    identity,
  );
  const userConfig = await loadSubSessionUserConfig({
    workspaceService: dependencies.workspaceService,
    configService: dependencies.configService,
    userId: identity.userId,
  });
  const effectiveRunConfig = dependencies.prepareRunConfig({
    userId: identity.userId,
    runConfig: mergedRunConfig,
    userConfig,
  });
  assertPreparedRunConfig(effectiveRunConfig);
  bindDetachedMessageIdentity(effectiveRunConfig, mergedRunConfig);
  const subSessionAttachments = await transferCanonicalAttachmentsToSubSession({
    attachmentService: dependencies.attachmentService,
    userId: identity.userId,
    parentSessionId: identity.parentSessionId,
    subSessionId: identity.subSessionId,
    attachments: request.attachments,
    attachmentPolicy: effectiveRunConfig.attachments,
  });
  const systemMessages = await resolveDetachedSystemMessages(
    request.systemMessageFactory,
    subSessionAttachments,
  );
  emitDetachedIdentityEvents(dependencies, request, identity, effectiveRunConfig);
  return { mergedRunConfig, effectiveRunConfig, subSessionAttachments, systemMessages };
}

function createDetachedRunConfig(
  dependencies,
  { strategy, metadata, runConfigPatch },
  inheritedRunConfig,
  inheritedRuntime,
  identity,
) {
  if (typeof dependencies.mergeRunConfigPluginPolicy !== "function") {
    throw new TypeError("detached sub-session runner requires mergeRunConfigPluginPolicy");
  }
  const config = dependencies.mergeRunConfigPluginPolicy({
    baseRunConfig: inheritedRunConfig,
    runConfigPatch,
    disabledPlugins: strategy.disabledPlugins || [],
  });
  const runtimeModel =
    String(runConfigPatch.runtimeModel || "").trim() ||
    readSelectedModelValue(config.selectedModel) ||
    String(inheritedRunConfig.runtimeModel || "").trim() ||
    String(inheritedRuntime?.runtimeModel || "").trim();
  if (runtimeModel) config.runtimeModel = runtimeModel;
  else delete config.runtimeModel;
  config.executionId = identity.executionId;
  config.executionKind = "agent";
  config.parentExecutionId = String(
    strategy.parentExecutionId || metadata.parentExecutionId || "",
  ).trim();
  config.rootExecutionId = String(
    strategy.rootExecutionId || metadata.rootExecutionId || identity.executionId,
  ).trim();
  const presentationMessageId = `msg_${randomUUID()}`;
  config.presentationMessageId = presentationMessageId;
  config.messageId = `msg_event_${presentationMessageId}`;
  delete config.assistantMessageId;
  if (!String(config.thinkingStartedAt || "").trim()) {
    config.thinkingStartedAt = String(dependencies.now()).trim();
  }
  for (const key of ["hookManager", "hooks", "botHookManager", "botHooks"]) delete config[key];
  return config;
}

function assertPreparedRunConfig(config) {
  if (isObjectRecord(config)) return;
  throw new Error("detached sub-session prepareRunConfig must return a run config object");
}

function bindDetachedMessageIdentity(effectiveRunConfig, mergedRunConfig) {
  effectiveRunConfig.presentationMessageId = mergedRunConfig.presentationMessageId;
  effectiveRunConfig.messageId = mergedRunConfig.messageId;
  delete effectiveRunConfig.assistantMessageId;
}

async function resolveDetachedSystemMessages(systemMessageFactory, attachments) {
  const messages =
    typeof systemMessageFactory === "function" ? await systemMessageFactory({ attachments }) : [];
  if (!Array.isArray(messages)) {
    throw new TypeError("detached sub-session systemMessageFactory must return an array");
  }
  return messages;
}

function emitDetachedIdentityEvents(dependencies, request, identity, effectiveRunConfig) {
  emitEvent(request.eventListener, "detached_sub_session_message_identity_bound", {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    dialogProcessId: identity.subDialogProcessId,
    turnScopeId: identity.turnScopeId,
    workflowRunId: String(effectiveRunConfig.workflowRunId || "").trim(),
    nodeExecutionId: String(
      effectiveRunConfig.workflowNodeExecutionId || effectiveRunConfig.nodeExecutionId || "",
    ).trim(),
    messageId: effectiveRunConfig.messageId,
    presentationMessageId: effectiveRunConfig.presentationMessageId,
  });
  const runtimePluginState = buildRuntimePluginState({
    effectiveRunConfig,
    disabledPlugins: request.strategy?.disabledPlugins,
  });
  emitEvent(request.eventListener, "plugin_runtime_resolved", runtimePluginState);
}

async function createDetachedLifecycle(dependencies, request, identity, prepared) {
  const { session } = dependencies;
  const generation = await resolveDetachedSessionGeneration(session, identity);
  const runtimePluginState = buildRuntimePluginState({
    effectiveRunConfig: prepared.effectiveRunConfig,
    disabledPlugins: request.strategy?.disabledPlugins,
  });
  const persistenceScope = Object.freeze({
    scopeId: identity.executionId,
    parentSessionId: identity.parentSessionId,
    relativeDir: identity.relativeDir,
    allowedRoot: identity.allowedRoot,
  });
  const persistenceContext = session.createScopedPersistenceContext({
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    scopeId: identity.executionId,
    relativeDir: identity.relativeDir,
    allowedRoot: identity.allowedRoot,
    ...(generation ? { sessionGeneration: generation } : {}),
    metadataContributor: () => createDetachedMetadata(request, identity, runtimePluginState),
  });
  const lifecycleIdentity = createLifecycleIdentity(
    request,
    identity,
    prepared.mergedRunConfig,
    persistenceContext,
    persistenceScope,
  );
  return {
    persistenceContext,
    persistenceScope,
    commandId: String(
      request.strategy?.commandId ||
        request.runConfigPatch?.commandId ||
        identity.turnScopeId ||
        identity.subSessionId,
    ).trim(),
    commit: createLifecycleCommitter(session, lifecycleIdentity, identity.scopedEventListener),
  };
}

async function resolveDetachedSessionGeneration(session, identity) {
  if (typeof session.getSessionLifecycle !== "function") return 0;
  const lifecycle = await session.getSessionLifecycle({
    userId: identity.userId,
    sessionId: identity.subSessionId,
  });
  const generation = Number(lifecycle?.generation);
  return Number.isInteger(generation) && generation > 0 ? generation : 0;
}

function createDetachedMetadata(request, identity, runtimePluginState) {
  return {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    parentDialogProcessId: identity.parentDialogProcessId,
    dialogProcessId: identity.subDialogProcessId || identity.subSessionId,
    ...(isObjectRecord(request.metadata) ? request.metadata : {}),
    runtimePluginState,
  };
}

function createLifecycleIdentity(request, identity, config, persistenceContext, persistenceScope) {
  return {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    persistenceContext,
    persistenceScope,
    turnScopeId: identity.turnScopeId,
    dialogProcessId: identity.subDialogProcessId || identity.subSessionId,
    messageId: config.messageId,
    presentationMessageId: config.presentationMessageId,
    executionId: identity.executionId,
    executionKind: "agent",
    parentExecutionId: config.parentExecutionId,
    rootExecutionId: config.rootExecutionId,
    origin: request.metadata?.origin || {},
    stage: String(request.metadata?.scope || "detached_sub_session").trim(),
  };
}

function createLifecycleCommitter(session, lifecycleIdentity, scopedEventListener) {
  return async (event = {}) => {
    if (typeof session.applyTurnLifecycleEvent !== "function") {
      throw new Error("detached sub-session requires authoritative Turn lifecycle support");
    }
    const committed = await session.applyTurnLifecycleEvent({ ...lifecycleIdentity, ...event });
    if (!committed?.applied && !committed?.deduplicated) {
      throw new Error(committed?.reason || "detached sub-session lifecycle commit failed");
    }
    if (committed.envelope) {
      await scopedEventListener?.onEvent?.({
        event: "turn_lifecycle_committed",
        data: {
          envelope: committed.envelope,
          persistenceScope: lifecycleIdentity.persistenceScope,
        },
      });
    }
    return committed;
  };
}

async function commitDetachedStart(lifecycle, startedAt, request, identity, runConfig) {
  const accepted = await lifecycle.commit({
    commandId: `${lifecycle.commandId}:accepted`,
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    executionState: "accepted",
    startedAt,
    createSessionIfAbsent: true,
    expectedRevision: 0,
    userMessage: {
      content: String(request.message || "").trim(),
      messageId: String(runConfig?.userMessageId || "").trim(),
      parentDialogProcessId: identity.parentDialogProcessId,
      frontendUserMessage: false,
    },
  });
  await lifecycle.commit({
    commandId: `${lifecycle.commandId}:processing-started`,
    eventType: TURN_EVENT.PROCESSING_STARTED,
    phase: TURN_PHASE.PROCESSING,
    executionState: "sending",
  });
  return accepted;
}

async function executeDetachedSession(
  dependencies,
  request,
  runtime,
  identity,
  prepared,
  lifecycle,
) {
  const result = await dependencies.sessionRunner.runSession({
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    parentDialogProcessId: identity.parentDialogProcessId,
    dialogProcessId: identity.subDialogProcessId,
    caller: CALLER_ROLE.BOT,
    message: request.message || "",
    attachments: prepared.subSessionAttachments,
    systemMessages: prepared.systemMessages,
    turnAcceptance: prepared.turnAcceptance,
    eventListener: identity.scopedEventListener,
    abortSignal: identity.abortSignal,
    userInteractionBridge: identity.userInteractionBridge,
    runConfig: prepared.effectiveRunConfig,
    turnScopeId: identity.turnScopeId,
    parentAsyncResultContainer: null,
    persistenceContext: lifecycle.persistenceContext,
    persistenceScope: lifecycle.persistenceScope,
  });
  assertDetachedDialogIdentity(result, request, identity);
  return result;
}

function assertDetachedDialogIdentity(result, request, identity) {
  const returnedDialogProcessId = String(result?.dialogProcessId || "").trim();
  if (!returnedDialogProcessId || returnedDialogProcessId === identity.subDialogProcessId) return;
  const error = new Error(
    "detached sub-session returned a dialogProcessId different from its authoritative turn identity",
  );
  error.code = "DETACHED_DIALOG_IDENTITY_MISMATCH";
  emitEvent(request.eventListener, "detached_sub_session_identity_mismatch", {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    turnScopeId: identity.turnScopeId,
    executionId: identity.executionId,
    authoritativeDialogProcessId: identity.subDialogProcessId,
    returnedDialogProcessId,
    code: error.code,
  });
  throw error;
}

async function commitDetachedError(error, dependencies, request, runtime, identity, lifecycle) {
  const stopped = identity.abortSignal?.aborted || error?.name === "AbortError";
  const terminalLifecycle = stopped
    ? await commitDetachedStop(dependencies, lifecycle)
    : await commitDetachedFailure(error, lifecycle);
  if (error && typeof error === "object") {
    error.lifecycle = createDetachedTerminalReceipt({
      lifecycle: terminalLifecycle?.turn || error.lifecycle,
      executionId: identity.executionId,
      failed: !stopped,
    });
  }
  emitDetachedTerminalEvent(request, identity, terminalLifecycle, error, stopped);
}

async function commitDetachedStop(dependencies, lifecycle) {
  await lifecycle.commit({
    commandId: `${lifecycle.commandId}:stop-accepted`,
    eventType: TURN_EVENT.STOP_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "stop",
  });
  await lifecycle.commit({
    commandId: `${lifecycle.commandId}:stop-processing-completed`,
    eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
    phase: TURN_PHASE.STOP,
  });
  const completionCommitId = `${lifecycle.commandId}:stop-completed`;
  return lifecycle.commit({
    commandId: completionCommitId,
    eventType: TURN_EVENT.STOP_COMPLETED,
    phase: TURN_PHASE.STOP,
    executionState: "user_stopped",
    completionCommitId,
    terminalStatus: { command: "user_stopped", description: "子 Agent 已停止" },
    finishedAt: String(dependencies.now()).trim(),
  });
}

function commitDetachedFailure(error, lifecycle) {
  return lifecycle.commit({
    commandId: `${lifecycle.commandId}:failed`,
    eventType: TURN_EVENT.FAILED,
    phase: TURN_PHASE.PROCESSING,
    failure: {
      phase: TURN_PHASE.PROCESSING,
      code: String(error?.code || "detached_sub_session_failed").trim(),
      message: String(error?.message || "detached sub-session failed"),
      retryable: false,
    },
  });
}

function emitDetachedTerminalEvent(request, identity, terminalLifecycle, error, stopped) {
  emitEvent(
    request.eventListener,
    stopped ? "detached_sub_session_stop_committed" : "detached_sub_session_failure_committed",
    {
      userId: identity.userId,
      sessionId: identity.subSessionId,
      parentSessionId: identity.parentSessionId,
      dialogProcessId: identity.subDialogProcessId,
      turnScopeId: identity.turnScopeId,
      executionId: identity.executionId,
      ...(stopped
        ? { reason: "user_stop" }
        : { errorCode: String(error?.code || "detached_sub_session_failed").trim() }),
      state: String(terminalLifecycle?.turn?.state || "").trim(),
      revision: Number(terminalLifecycle?.turn?.revision || 0),
      sequence: Number(terminalLifecycle?.turn?.sequence || 0),
    },
  );
}

async function commitDetachedCompletion(dependencies, lifecycle) {
  await lifecycle.commit({
    commandId: `${lifecycle.commandId}:processing-completed`,
    eventType: TURN_EVENT.PROCESSING_COMPLETED,
    phase: TURN_PHASE.COMPLETION,
  });
  const completionCommitId = `${lifecycle.commandId}:completed`;
  return lifecycle.commit({
    commandId: completionCommitId,
    eventType: TURN_EVENT.COMPLETED,
    phase: TURN_PHASE.COMPLETION,
    executionState: "completed",
    completionCommitId,
    terminalStatus: { command: "completed", description: "子 Agent 已正常完成" },
    finishedAt: String(dependencies.now()).trim(),
  });
}

function projectDetachedResult(result, identity, prepared, terminalLifecycle) {
  const dialogProcessId = String(
    result?.dialogProcessId || identity.subDialogProcessId || identity.subSessionId,
  ).trim();
  const transferEnvelopes = collectTransferEnvelopes(result?.turnMessages);
  return {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    dialogProcessId,
    persisted: result?.session || null,
    lifecycle: createDetachedTerminalReceipt({
      lifecycle: terminalLifecycle?.turn || result?.lifecycle,
      executionId: prepared.mergedRunConfig.executionId,
    }),
    result: {
      sessionId: identity.subSessionId,
      parentSessionId: identity.parentSessionId,
      parentDialogProcessId: identity.parentDialogProcessId,
      caller: CALLER_ROLE.BOT,
      answer: String(result?.output || result?.answer || "").trim(),
      traces: readArray(result?.traces),
      messages: readArray(result?.turnMessages),
      ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
      turnTasks: readArray(result?.turnTasks),
      executionLogs: [],
      dialogProcessId,
    },
  };
}

function readArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectTransferEnvelopes(turnMessages) {
  return Array.from(
    new Map(
      (Array.isArray(turnMessages) ? turnMessages : [])
        .flatMap((message = {}) =>
          Array.isArray(message.transferEnvelopes) ? message.transferEnvelopes : [],
        )
        .map((envelope) => [String(envelope?.transferId || ""), envelope])
        .filter(([transferId]) => transferId),
    ).values(),
  );
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clearParentTurnTransactionIdentity(runConfig = {}) {
  delete runConfig.resumeFromStoppedSnapshot;
  delete runConfig.resumeDialogProcessId;
  delete runConfig.resumeTurnScopeId;
  delete runConfig.expectedAggregateVersion;
  delete runConfig.commandId;
  delete runConfig.reuseExistingUserTurn;
  delete runConfig.thinkingStartedAt;
  delete runConfig.messageId;
  delete runConfig.presentationMessageId;
  delete runConfig.assistantMessageId;
  return runConfig;
}

function createAbortGuard(abortSignal = null) {
  return () => {
    if (!abortSignal?.aborted) return;
    const error = new Error("bot plugin sub-session aborted");
    error.name = "AbortError";
    error.code = "ABORT_ERR";
    throw error;
  };
}

async function loadSubSessionUserConfig({
  workspaceService = null,
  configService = null,
  userId = "",
} = {}) {
  const workspacePath = workspaceService.getWorkspacePath(userId);
  return configService.loadUserConfig(workspacePath);
}

function buildRuntimePluginState({ effectiveRunConfig = {}, disabledPlugins = [] } = {}) {
  const selectedPlugins = normalizeTrimmedStringList(effectiveRunConfig?.selectedPlugins);
  const plugins =
    effectiveRunConfig?.plugins && typeof effectiveRunConfig.plugins === "object"
      ? effectiveRunConfig.plugins
      : {};
  return {
    selectedPlugins,
    plugins: Object.fromEntries(
      selectedPlugins.map((pluginId) => [
        pluginId,
        {
          enabled: plugins?.[pluginId]?.enabled === true,
          mode: String(plugins?.[pluginId]?.mode || "")
            .trim()
            .toLowerCase(),
        },
      ]),
    ),
    hookManagersReady: Boolean(
      effectiveRunConfig?.hookManager && effectiveRunConfig?.botHookManager,
    ),
    disabledPlugins: normalizeTrimmedStringList(disabledPlugins),
    scope: "detached_sub_session",
  };
}
