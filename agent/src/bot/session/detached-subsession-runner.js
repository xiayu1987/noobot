/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { AGENT_RUN_EVENT, createExecutionEventListener, emitEvent } from "../../events/index.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { CALLER_ROLE } from "../config/constants.js";
import {
  TURN_ACTION,
  TURN_EVENT,
  TURN_PHASE,
  createAssistantMessageEventId,
  createSessionPersistenceScope,
  createTurnAcceptanceReceipt,
  createTurnLifecycleCommandId,
  deriveTurnCommandId,
  EXECUTION_KIND,
  isExecutionAbortError,
} from "@noobot/session-protocol";
import { normalizeTrimmedStringList } from "./session-execution-engine-utils.js";
import {
  createDetachedTerminalReceipt,
  createScopedSubSessionEventListener,
} from "./detached-subsession-events.js";
import { createExecutionFailure } from "../../shared/errors/index.js";
import { transferCanonicalAttachmentsToSubSession } from "./detached-subsession-attachments.js";
import { isPlainObject, text } from "@noobot/shared/value";

export { createDetachedTerminalReceipt, createScopedSubSessionEventListener };

function assertDetachedSubSessionStrategy(strategy = {}) {
  const required = [
    "sessionId",
    "dialogProcessId",
    "turnScopeId",
    "executionId",
    "rootExecutionId",
    "relativeDir",
    "allowedRoot",
  ];
  if (required.some((key) => !text(strategy?.[key]))) {
    throw new TypeError(`detached sub-session strategy requires ${required.join(", ")}`);
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
  prepared.turnAcceptance = createTurnAcceptanceReceipt({
    commandId: lifecycle.commandId,
    sessionId: identity.subSessionId,
    turnScopeId: identity.turnScopeId,
    dialogProcessId: identity.subDialogProcessId,
    messageUid: accepted.userMessage.messageUid,
    aggregateVersion: accepted.aggregateVersion,
    committedEventPublished: false,
  });
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
    throw await commitDetachedError(error, dependencies, request, runtime, identity, lifecycle);
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
  const { parentExecutionScope, eventListener, metadata = {} } = request;
  try {
    return getRuntimeFromAgentContext(parentExecutionScope);
  } catch (error) {
    emitEvent(eventListener, "detached_sub_session_scope_rejected", {
      scopeId: text(metadata.scope),
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
    userId: text(strategy.userId || sourceContext.userId),
    parentSessionId: text(strategy.parentSessionId || sourceContext.sessionId),
    parentDialogProcessId: text(strategy.parentDialogProcessId || sourceContext.dialogProcessId),
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
  Object.assign(identity, resolveChildStrategyIdentity(strategy), resolveDetachedStage(request));
  identity.scopedEventListener = createScopedSubSessionEventListener(request.eventListener, {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    dialogProcessId: identity.subDialogProcessId,
    turnScopeId: identity.turnScopeId,
  });
  return identity;
}

function resolveDetachedStage(request) {
  const stage = text(request.metadata?.scope);
  if (!stage) throw new Error("detached sub-session requires metadata.scope");
  const origin = request.metadata?.origin;
  return { stage, origin: isObjectRecord(origin) ? { ...origin } : {} };
}

function resolveChildStrategyIdentity(strategy) {
  return {
    subSessionId: text(strategy.sessionId),
    subDialogProcessId: text(strategy.dialogProcessId),
    turnScopeId: text(strategy.turnScopeId),
    commandId: deriveTurnCommandId(strategy.turnScopeId),
    executionId: text(strategy.executionId),
    parentExecutionId: text(strategy.parentExecutionId),
    rootExecutionId: text(strategy.rootExecutionId),
    relativeDir: text(strategy.relativeDir),
    allowedRoot: text(strategy.allowedRoot),
  };
}

async function prepareDetachedExecution(dependencies, request, inheritedRuntime, identity) {
  const { strategy = {}, runConfigPatch = {}, parentContext = {} } = request;
  const inheritedRunConfig = clearParentTurnTransactionIdentity({
    ...(isObjectRecord(parentContext.runConfig)
      ? parentContext.runConfig
      : isObjectRecord(inheritedRuntime?.runConfig)
        ? inheritedRuntime.runConfig
        : {}),
  });
  const mergedRunConfig = createDetachedRunConfig(
    dependencies,
    { strategy, runConfigPatch },
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
  return { mergedRunConfig, effectiveRunConfig, subSessionAttachments, systemMessages };
}

function createDetachedRunConfig(
  dependencies,
  { strategy, runConfigPatch },
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
    text(runConfigPatch.runtimeModel) ||
    text(config.selectedModel) ||
    text(inheritedRunConfig.runtimeModel) ||
    text(inheritedRuntime?.runtimeModel);
  if (runtimeModel) config.runtimeModel = runtimeModel;
  else delete config.runtimeModel;
  config.executionId = identity.executionId;
  config.executionKind = EXECUTION_KIND.AGENT;
  config.parentExecutionId = identity.parentExecutionId;
  config.rootExecutionId = identity.rootExecutionId;
  config.origin = identity.origin;
  config.stage = identity.stage;
  config.commandId = identity.commandId;
  const presentationMessageId = `msg_${randomUUID()}`;
  config.presentationMessageId = presentationMessageId;
  config.messageId = createAssistantMessageEventId(presentationMessageId);
  delete config.assistantMessageId;
  if (!text(config.thinkingStartedAt)) {
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
  effectiveRunConfig.commandId = mergedRunConfig.commandId;
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

async function createDetachedLifecycle(dependencies, request, identity, prepared) {
  const { session } = dependencies;
  const runtimePluginState = buildRuntimePluginState({
    effectiveRunConfig: prepared.effectiveRunConfig,
    disabledPlugins: request.strategy?.disabledPlugins,
  });
  const persistenceScope = createSessionPersistenceScope({
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
    metadataContributor: () => createDetachedMetadata(request, identity, runtimePluginState),
  });
  const lifecycleIdentity = createLifecycleIdentity(
    identity,
    prepared.mergedRunConfig,
    persistenceContext,
    persistenceScope,
  );
  return {
    persistenceContext,
    persistenceScope,
    factListener: createExecutionEventListener({
      sessionManager: session,
      userId: identity.userId,
      sessionId: identity.subSessionId,
      parentSessionId: identity.parentSessionId,
      turnScopeId: identity.turnScopeId,
      persistenceContext,
      upstream: { dialogProcessId: identity.subDialogProcessId },
    }),
    commandId: identity.commandId,
    commit: createLifecycleCommitter(session, lifecycleIdentity, identity.scopedEventListener),
  };
}

function createDetachedMetadata(request, identity, runtimePluginState) {
  return {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    parentDialogProcessId: identity.parentDialogProcessId,
    dialogProcessId: identity.subDialogProcessId,
    ...(isObjectRecord(request.metadata) ? request.metadata : {}),
    runtimePluginState,
  };
}

function createLifecycleIdentity(identity, config, persistenceContext, persistenceScope) {
  return {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    persistenceContext,
    persistenceScope,
    turnScopeId: identity.turnScopeId,
    dialogProcessId: identity.subDialogProcessId,
    messageId: config.messageId,
    presentationMessageId: config.presentationMessageId,
    executionId: identity.executionId,
    executionKind: EXECUTION_KIND.AGENT,
    parentExecutionId: config.parentExecutionId,
    rootExecutionId: config.rootExecutionId,
    origin: identity.origin,
    stage: identity.stage,
  };
}

function createLifecycleCommitter(session, lifecycleIdentity, scopedEventListener) {
  return async (event = {}) => {
    const committed = await session.applyTurnLifecycleEvent({ ...lifecycleIdentity, ...event });
    if (!committed?.applied && !committed?.deduplicated) {
      throw new Error(committed?.reason || "detached sub-session lifecycle commit failed");
    }
    if (committed.envelope) {
      await scopedEventListener?.onEvent?.({
        event: AGENT_RUN_EVENT.TURN_LIFECYCLE_COMMITTED,
        data: {
          envelope: committed.envelope,
          persistenceScope: lifecycleIdentity.persistenceScope,
        },
      });
    }
    return committed;
  };
}

function lifecycleCommandId(lifecycle, eventType, phase = "") {
  return createTurnLifecycleCommandId({ commandId: lifecycle.commandId, eventType, phase });
}

async function commitDetachedStart(lifecycle, startedAt, request, identity, runConfig) {
  const accepted = await lifecycle.commit({
    commandId: lifecycleCommandId(lifecycle, TURN_EVENT.ACTION_ACCEPTED),
    causationId: lifecycle.commandId,
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: TURN_ACTION.SEND,
    executionState: "accepted",
    startedAt,
    createSessionIfAbsent: true,
    expectedRevision: 0,
    userMessage: {
      content: text(request.message),
      messageId: text(runConfig?.userMessageId),
      parentDialogProcessId: identity.parentDialogProcessId,
      messageOrigin: "internal",
      userMetaMaterialized: false,
    },
  });
  await lifecycle.commit({
    commandId: lifecycleCommandId(lifecycle, TURN_EVENT.PROCESSING_STARTED),
    causationId: lifecycle.commandId,
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
  assertDetachedDialogIdentity(result, identity, lifecycle);
  return result;
}

function assertDetachedDialogIdentity(result, identity, lifecycle) {
  const returnedDialogProcessId = text(result?.dialogProcessId);
  if (!returnedDialogProcessId || returnedDialogProcessId === identity.subDialogProcessId) return;
  const error = new Error(
    "detached sub-session returned a dialogProcessId different from its authoritative turn identity",
  );
  error.code = "DETACHED_DIALOG_IDENTITY_MISMATCH";
  emitEvent(lifecycle.factListener, "detached_sub_session_identity_mismatch", {
    executionId: identity.executionId,
    authoritativeDialogProcessId: identity.subDialogProcessId,
    returnedDialogProcessId,
    code: error.code,
  });
  throw error;
}

async function commitDetachedError(error, dependencies, request, runtime, identity, lifecycle) {
  const stopped = isExecutionAbortError({ error, abortSignal: identity.abortSignal });
  const terminalLifecycle = stopped
    ? await commitDetachedStop(dependencies, lifecycle)
    : await commitDetachedFailure(error, lifecycle);
  const receipt = createDetachedTerminalReceipt(terminalLifecycle.turn);
  const executionFailure = createExecutionFailure(error, receipt);
  emitDetachedTerminalEvent(
    lifecycle.factListener,
    identity,
    terminalLifecycle,
    executionFailure,
    stopped,
  );
  await lifecycle.factListener.flush();
  return executionFailure;
}

async function commitDetachedStop(dependencies, lifecycle) {
  const completionCommitId = lifecycleCommandId(lifecycle, TURN_EVENT.STOP_COMPLETED);
  await lifecycle.commit({
    commandId: lifecycleCommandId(lifecycle, TURN_EVENT.STOP_ACCEPTED),
    causationId: lifecycle.commandId,
    eventType: TURN_EVENT.STOP_ACCEPTED,
    phase: TURN_PHASE.STOP,
    action: TURN_ACTION.STOP,
  });
  await lifecycle.commit({
    commandId: lifecycleCommandId(lifecycle, TURN_EVENT.STOP_PROCESSING_COMPLETED),
    causationId: lifecycle.commandId,
    eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED,
    phase: TURN_PHASE.STOP,
    completionCommitId,
  });
  return lifecycle.commit({
    commandId: completionCommitId,
    causationId: lifecycle.commandId,
    eventType: TURN_EVENT.STOP_COMPLETED,
    phase: TURN_PHASE.STOP,
    executionState: "user_stopped",
    terminalStatus: { command: "user_stopped" },
    finishedAt: String(dependencies.now()).trim(),
  });
}

function commitDetachedFailure(error, lifecycle) {
  const message = String(error?.message || "detached sub-session failed");
  return lifecycle.commit({
    commandId: lifecycleCommandId(lifecycle, TURN_EVENT.FAILED, TURN_PHASE.PROCESSING),
    causationId: lifecycle.commandId,
    eventType: TURN_EVENT.FAILED,
    phase: TURN_PHASE.PROCESSING,
    failure: {
      code: text(error?.code) || "detached_sub_session_failed",
      message,
      retryable: false,
    },
    terminalStatus: { command: "error", description: message, error },
  });
}

function emitDetachedTerminalEvent(factListener, identity, terminalLifecycle, error, stopped) {
  emitEvent(
    factListener,
    stopped ? "detached_sub_session_stop_committed" : "detached_sub_session_failure_committed",
    {
      executionId: identity.executionId,
      ...(stopped
        ? { reason: "user_stop" }
        : { errorCode: text(error?.code) || "detached_sub_session_failed" }),
      state: text(terminalLifecycle?.turn?.state),
      revision: Number(terminalLifecycle?.turn?.revision || 0),
      sequence: Number(terminalLifecycle?.turn?.sequence || 0),
    },
  );
}

async function commitDetachedCompletion(dependencies, lifecycle) {
  const completionCommitId = lifecycleCommandId(lifecycle, TURN_EVENT.COMPLETED);
  await lifecycle.commit({
    commandId: lifecycleCommandId(lifecycle, TURN_EVENT.PROCESSING_COMPLETED),
    causationId: lifecycle.commandId,
    eventType: TURN_EVENT.PROCESSING_COMPLETED,
    phase: TURN_PHASE.COMPLETION,
    completionCommitId,
  });
  return lifecycle.commit({
    commandId: completionCommitId,
    causationId: lifecycle.commandId,
    eventType: TURN_EVENT.COMPLETED,
    phase: TURN_PHASE.COMPLETION,
    executionState: "completed",
    terminalStatus: { command: "completed" },
    finishedAt: String(dependencies.now()).trim(),
  });
}

function projectDetachedResult(result, identity, prepared, terminalLifecycle) {
  const dialogProcessId = identity.subDialogProcessId;
  const messages = readArray(result?.messages);
  const transferEnvelopes = collectTransferEnvelopes(messages);
  return {
    userId: identity.userId,
    sessionId: identity.subSessionId,
    parentSessionId: identity.parentSessionId,
    dialogProcessId,
    lifecycle: createDetachedTerminalReceipt(terminalLifecycle.turn),
    result: {
      sessionId: identity.subSessionId,
      parentSessionId: identity.parentSessionId,
      parentDialogProcessId: identity.parentDialogProcessId,
      caller: CALLER_ROLE.BOT,
      answer: text(result?.answer),
      traces: readArray(result?.traces),
      messages,
      ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
      turnTasks: readArray(result?.turnTasks),
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
  return Boolean(isPlainObject(value));
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
          mode: text(plugins?.[pluginId]?.mode).toLowerCase(),
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
