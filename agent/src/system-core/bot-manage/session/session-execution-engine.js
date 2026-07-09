/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  runAgentTurn,
  AgentContextFactory,
  AgentRuntimeFacade,
} from "../../agent/index.js";
import { recoverableToolError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { SessionExecutionInitializer } from "../execution/initializer.js";
import { SessionExecutionFinalizer } from "../execution/finalizer.js";
import { SessionTurnPersister } from "../execution/turn-persister.js";
import { SessionExecutionRunner } from "../execution/runner.js";
import { BotManageValidator } from "../config/validator.js";
import { ParentAsyncTaskManager } from "../execution/parent-async-task-manager.js";
import { RunConfigResolver } from "../config/run-config-resolver.js";
import { MemoryPostProcessService } from "../execution/memory-postprocess.js";
import { CALLER_ROLE } from "../config/constants.js";
import { ERROR_CODE } from "../../error/constants.js";
import {
  getRuntimeFromAgentContext,
} from "../../context/agent-context-accessor.js";
import {
  findMatchingAttachmentMeta,
  mapAttachmentRecordsToMetas,
  mergeAttachmentMetaPreferRich,
  readAttachIndex,
} from "../../attach/index.js";
import { MIME_TYPE } from "../../constants/index.js";
import path from "node:path";
import { normalizeTrimmedStringList } from "./session-execution-engine-utils.js";
import { createDetachedSubSessionRunner } from "./detached-subsession-runner.js";
import { ModelMessageRuntimeHelpers } from "./model-message-runtime-helpers.js";
import { ScopedArtifactPersistenceHelpers } from "./scoped-artifact-persistence-helpers.js";
import {
  createDefaultRunConfigPluginPreparer,
  createRunConfigPluginPreparerFromRuntimeBundle,
  getDefaultSessionPluginRuntime,
} from "../../plugin/session-plugin-runtime-provider.js";
import { loadStoppedModelMessageSnapshot } from "../../agent/core/resume/model-message-snapshot-store.js";

export class SessionExecutionEngine {
  constructor({
    globalConfig = {},
    session = null,
    memory = null,
    attach = null,
    skill = null,
    configService = null,
    workspaceService = null,
    errorLogger = null,
    botManager = null,
    agentRunner = runAgentTurn,
    pluginRuntimeBundle = null,
  } = {}) {
    this._assignCoreDependencies({
      globalConfig,
      session,
      memory,
      attach,
      skill,
      configService,
      workspaceService,
      errorLogger,
      botManager,
      agentRunner,
      pluginRuntimeBundle,
    });
    this._initializeCoreServices();
    this._initializeRuntimeServices();
    this._initializeExecutionServices();
    this.runner = this._createRunner();
  }

  _assignCoreDependencies({
    globalConfig = {},
    session = null,
    memory = null,
    attach = null,
    skill = null,
    configService = null,
    workspaceService = null,
    errorLogger = null,
    botManager = null,
    agentRunner = runAgentTurn,
    pluginRuntimeBundle = null,
  } = {}) {
    this.globalConfig = globalConfig;
    this.session = session;
    this.memory = memory;
    this.attach = attach;
    this.skill = skill;
    this.configService = configService;
    this.workspaceService = workspaceService;
    this.errorLogger = errorLogger;
    this.botManager = botManager;
    this.agentRunner = typeof agentRunner === "function" ? agentRunner : runAgentTurn;
    this.pluginRuntimeBundle = pluginRuntimeBundle;
  }

  _initializeCoreServices() {
    this.validator = new BotManageValidator();
    this.parentAsyncTaskManager = new ParentAsyncTaskManager({
      now: () => this._now(),
    });
    this.runConfigResolver = new RunConfigResolver({
      globalConfig: this.globalConfig,
    });
    this.memoryPostProcessService = new MemoryPostProcessService({
      globalConfig: this.globalConfig,
      memory: this.memory,
      errorLogger: this.errorLogger,
    });
  }

  _initializeRuntimeServices() {
    this.agentContextFactory = this._createAgentContextFactory();
    this.agentRuntimeFacade = new AgentRuntimeFacade({
      contextFactory: this.agentContextFactory,
      turnRunner: this.agentRunner,
    });
    this.modelMessageRuntimeHelpers = new ModelMessageRuntimeHelpers({
      session: this.session,
    });
    this.scopedArtifactPersistenceHelpers = new ScopedArtifactPersistenceHelpers({
      session: this.session,
      attach: this.attach,
      workspaceService: this.workspaceService,
      now: () => this._now(),
    });
    this.runConfigPluginPreparer = this._createRunConfigPluginPreparer();
  }

  _initializeExecutionServices() {
    this.turnPersister = new SessionTurnPersister({
      session: this.session,
    });
    this.initializer = new SessionExecutionInitializer({
      session: this.session,
      configService: this.configService,
      workspaceService: this.workspaceService,
    });
    this.finalizer = new SessionExecutionFinalizer({
      session: this.session,
      turnPersister: this.turnPersister,
      resolveMemoryPostProcessAsyncEnabled: (userConfig = {}) =>
        this._resolveMemoryPostProcessAsyncEnabled(userConfig),
      runMemoryPostProcessFlow: (payload = {}) =>
        this._runMemoryPostProcessFlow(payload),
      resolveExecutionBundleTimeoutMs: (userConfig = {}) =>
        this._resolveExecutionBundleTimeoutMs(userConfig),
      upsertParentAsyncTask: (payload = {}) => this._upsertParentAsyncTask(payload),
      now: () => this._now(),
    });
  }

  _createAgentContextFactory() {
    return new AgentContextFactory({
      globalConfig: this.globalConfig,
      session: this.session,
      memory: this.memory,
      attach: this.attach,
      skill: this.skill,
      botManager: this.botManager,
      applyRunConfigToolPolicy: (agentContext = {}, runConfig = {}) =>
        this._applyRunConfigToolPolicy(agentContext, runConfig),
    });
  }

  _createRunConfigPluginPreparer() {
    const factory = this.pluginRuntimeBundle
      ? createRunConfigPluginPreparerFromRuntimeBundle
      : createDefaultRunConfigPluginPreparer;
    return factory({
      loadedPlugins: this.pluginRuntimeBundle?.loadedPlugins,
      pluginRuntime: this.pluginRuntimeBundle?.pluginRuntime,
      globalConfig: this.globalConfig,
      workspaceService: this.workspaceService,
      normalizeStringArray: (input) => this._normalizeStringArray(input),
      mergePluginOptions: (...items) => this._mergePluginOptions(...items),
      createPluginResolveModelMessages: (payload = {}) =>
        this._createPluginResolveModelMessages(payload),
      createPluginMarkMessagesSummarized: () => this._createPluginMarkMessagesSummarized(),
      createDetachedSubSessionRunner: () => this._createDetachedSubSessionRunner(),
      createGeneratedArtifactPersister: () => this._createGeneratedArtifactPersister(),
      createScopedJsonWriter: () => this._createScopedJsonWriter(),
      createScopedEventLogger: () => this._createScopedEventLogger(),
    });
  }

  _createRunner() {
    // SessionExecutionRunner dependency wiring (grouped by concern)
    const runnerValidationDeps = {
      normalizeRunMessage: (message) => this._normalizeRunMessage(message),
      validateRunInput: (payload = {}) => this._validateRunInput(payload),
    };
    const runnerRuntimeDeps = {
      ensureParentAsyncResultContainer: (payload = {}) =>
        this._ensureParentAsyncResultContainer(payload),
      initializeRunSessionRuntime: (payload = {}) =>
        this._initializeRunSessionRuntime(payload),
      resolveScenarioRunConfig: (runConfig = {}, userConfig = {}) =>
        this._resolveScenarioRunConfig(runConfig, userConfig),
      prepareRunConfig: (payload = {}) => this._prepareRunConfig(payload),
      prepareAgentTurnExecution: (payload = {}) =>
        this._prepareAgentTurnExecution(payload),
    };
    const runnerPersistenceDeps = {
      appendSessionTurn: (payload = {}) => this._appendSessionTurn(payload),
      stampReusedUserTurnDialogProcessId: (payload = {}) =>
        this._stampReusedUserTurnDialogProcessId(payload),
      finalizeRunSession: (payload = {}) => this._finalizeRunSession(payload),
      upsertParentAsyncTask: (payload = {}) => this._upsertParentAsyncTask(payload),
    };
    return new SessionExecutionRunner({
      agentRunner: (payload = {}) => this.agentRuntimeFacade.runTurn(payload),
      errorLogger: this.errorLogger,
      ...runnerValidationDeps,
      ...runnerRuntimeDeps,
      ...runnerPersistenceDeps,
      now: () => this._now(),
    });
  }

  _now() {
    return new Date().toISOString();
  }

  _normalizeRunMessage(message = "") {
    return this.validator.normalizeRunMessage(message);
  }

  _validateRunInput({
    userId,
    sessionId,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
  }) {
    this.validator.validateRunInput({
      userId,
      sessionId,
      caller,
      parentSessionId,
    });
  }

  _upsertParentAsyncTask({
    parentAsyncResultContainer = null,
    sessionId = "",
    parentSessionId = "",
    task = "",
    sharedTaskSpec = "",
    patch = {},
  }) {
    return this.parentAsyncTaskManager.upsertParentAsyncTask({
      parentAsyncResultContainer,
      sessionId,
      parentSessionId,
      task,
      sharedTaskSpec,
      patch,
    });
  }

  _ensureParentAsyncResultContainer({
    parentAsyncResultContainer = null,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
    parentDialogProcessId = "",
  }) {
    return this.parentAsyncTaskManager.ensureParentAsyncResultContainer({
      parentAsyncResultContainer,
      caller,
      parentSessionId,
      parentDialogProcessId,
    });
  }



  _normalizeStringArray(input = []) {
    return this.runConfigResolver.normalizeStringArray(input);
  }

  _normalizeToolItems(input = []) {
    return this.runConfigResolver.normalizeToolItems(input);
  }

  _buildDefaultAssistantTurn({ agentResult = {}, dialogProcessId = "" }) {
    return this.turnPersister.buildDefaultAssistantTurn({
      agentResult,
      dialogProcessId,
    });
  }

  _resolveMemorySummaryTimeoutMs(userConfig = {}) {
    return this.memoryPostProcessService.resolveMemorySummaryTimeoutMs(userConfig);
  }

  _resolveMemorySummaryAsyncEnabled(userConfig = {}) {
    return this.memoryPostProcessService.resolveMemorySummaryAsyncEnabled(userConfig);
  }

  _resolveMemoryPostProcessAsyncEnabled(userConfig = {}) {
    return this.memoryPostProcessService.resolveMemoryPostProcessAsyncEnabled(userConfig);
  }

  _resolveExecutionBundleTimeoutMs(userConfig = {}) {
    return this.memoryPostProcessService.resolveExecutionBundleTimeoutMs(userConfig);
  }

  async _runMemorySummarizeFlow({
    userId,
    sessionId,
    userConfig = {},
    runtimeEventListener = null,
    mode = "sync",
  } = {}) {
    return this.memoryPostProcessService.runMemorySummarizeFlow({
      userId,
      sessionId,
      userConfig,
      runtimeEventListener,
      mode,
    });
  }

  async _runMemoryPostProcessFlow({
    userId,
    sessionId,
    parentSessionId = "",
    userConfig = {},
    runtimeEventListener = null,
    mode = "sync",
  } = {}) {
    return this.memoryPostProcessService.runMemoryPostProcessFlow({
      userId,
      sessionId,
      parentSessionId,
      userConfig,
      runtimeEventListener,
      mode,
    });
  }

  _applyRunConfigToolPolicy(agentContext = {}, runConfig = {}) {
    return this.runConfigResolver.applyRunConfigToolPolicy(agentContext, runConfig);
  }

  _mergeScenarioRestrictedList({ scenarioItems = [], currentItems = [], hasWildcard = false }) {
    return this.runConfigResolver.mergeScenarioRestrictedList({
      scenarioItems,
      currentItems,
      hasWildcard,
    });
  }

  _resolveScenarioRunConfig(runConfig = {}, userConfig = {}) {
    return this.runConfigResolver.resolveScenarioRunConfig(runConfig, userConfig);
  }

  _prepareRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    return this.runConfigPluginPreparer.prepareRunConfig({
      userId,
      runConfig,
      userConfig,
    });
  }

  _mergeRunConfigWithPluginStrategy({
    baseRunConfig = {},
    runConfigPatch = {},
    disabledPlugins = [],
  } = {}) {
    const merged = {
      ...(baseRunConfig && typeof baseRunConfig === "object" ? baseRunConfig : {}),
      ...(runConfigPatch && typeof runConfigPatch === "object" ? runConfigPatch : {}),
    };
    const disabledSet = new Set(normalizeTrimmedStringList(disabledPlugins));
    if (!disabledSet.size) return merged;
    const selectedPlugins = Array.isArray(merged?.selectedPlugins)
      ? merged.selectedPlugins
      : [];
    merged.selectedPlugins = normalizeTrimmedStringList(selectedPlugins)
      .filter((item) => !disabledSet.has(item));
    const plugins = merged?.plugins && typeof merged.plugins === "object" ? merged.plugins : {};
    const nextPlugins = { ...plugins };
    for (const pluginName of disabledSet) {
      const current =
        nextPlugins?.[pluginName] && typeof nextPlugins[pluginName] === "object"
          ? nextPlugins[pluginName]
          : {};
      nextPlugins[pluginName] = {
        ...current,
        enabled: false,
        mode: "off",
      };
    }
    merged.plugins = nextPlugins;
    return merged;
  }

  _resolveScopedOutputDir(payload = {}) {
    return this.scopedArtifactPersistenceHelpers.resolveScopedDir(payload);
  }

  _resolveScopedFileTarget(payload = {}) {
    return this.scopedArtifactPersistenceHelpers.resolveScopedFileTarget(payload);
  }

  async _persistSubSessionSnapshot(payload = {}) {
    return this.scopedArtifactPersistenceHelpers.persistSubSessionSnapshot(payload);
  }

  _normalizeDetachedSubSessionMessage(message = {}, now = "") {
    return this.scopedArtifactPersistenceHelpers.normalizeDetachedSubSessionMessage(message, now);
  }

  async _persistDetachedSubSessionSnapshot(payload = {}) {
    return this.scopedArtifactPersistenceHelpers.persistDetachedSubSessionSnapshot(payload);
  }

  async _assertDetachedSubSessionIsolation(payload = {}) {
    return this.scopedArtifactPersistenceHelpers.assertDetachedSubSessionIsolation(payload);
  }

  _createScopedJsonWriter() {
    return this.scopedArtifactPersistenceHelpers.createScopedJsonWriter();
  }

  _createScopedEventLogger() {
    return this.scopedArtifactPersistenceHelpers.createScopedEventLogger();
  }

  _createGeneratedArtifactPersister() {
    return this.scopedArtifactPersistenceHelpers.createGeneratedArtifactPersister();
  }

  _createDetachedSubSessionRunner() {
    return createDetachedSubSessionRunner({
      workspaceService: this.workspaceService,
      configService: this.configService,
      agentRuntimeFacade: this.agentRuntimeFacade,
      errorLogger: this.errorLogger,
      pluginRuntime: this.pluginRuntimeBundle?.pluginRuntime || getDefaultSessionPluginRuntime(),
      mergeRunConfigWithPluginStrategy: (payload = {}) =>
        this._mergeRunConfigWithPluginStrategy(payload),
      prepareRunConfig: (payload = {}) => this._prepareRunConfig(payload),
      prepareAgentTurnExecution: (payload = {}) =>
        this._prepareAgentTurnExecution(payload),
      resolveScopedOutputDir: (payload = {}) =>
        this._resolveScopedOutputDir(payload),
      normalizeDetachedSubSessionMessage: (message = {}, now = "") =>
        this._normalizeDetachedSubSessionMessage(message, now),
      persistDetachedSubSessionSnapshot: (payload = {}) =>
        this._persistDetachedSubSessionSnapshot(payload),
      assertDetachedSubSessionIsolation: (payload = {}) =>
        this._assertDetachedSubSessionIsolation(payload),
      now: () => this._now(),
    });
  }

  _buildContextBuilder({
    userId,
    sessionId,
    caller = CALLER_ROLE.USER,
    parentSessionId,
    userConfig,
    userMessageAttachments = [],
    attachments,
    systemMessages = [],
    eventListener,
    userInteractionBridge = null,
    runConfig = {},
    abortSignal = null,
    parentAsyncResultContainer = null,
  }) {
    return this.agentContextFactory.buildContextBuilder({
      userId,
      sessionId,
      caller,
      parentSessionId,
      userConfig,
      userMessageAttachments,
      attachments,
      systemMessages,
      eventListener,
      userInteractionBridge,
      runConfig,
      abortSignal,
      parentAsyncResultContainer,
    });
  }

  async _prepareAgentTurnExecution({
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
        : this._buildContextBuilder(payload);
    const prepared = payload?.runConfig?.resumeFromStoppedSnapshot === true
      ? await this._prepareStoppedSnapshotResumeTurnExecution({
          payload,
          contextBuilder,
          abortSignal,
        })
      : await this.agentRuntimeFacade.prepareTurnExecution({
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
    const existingSessionAttachments = await this._resolveExistingUserMessageAttachments({
      userId: String(payload?.userId || "").trim(),
      sessionId: String(payload?.sessionId || "").trim(),
      parentSessionId: String(payload?.parentSessionId || "").trim(),
      turnScopeId: String(payload?.turnScopeId || payload?.runConfig?.turnScopeId || "").trim(),
      dialogProcessId: String(payload?.dialogProcessId || "").trim(),
    });
    const enrichedRuntimeAttachments = await this._enrichUserInputAttachmentsFromIndex({
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

  async _prepareStoppedSnapshotResumeTurnExecution({
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
    const identity = {
      userId: String(payload?.userId || "").trim(),
      sessionId: String(payload?.sessionId || "").trim(),
      parentSessionId: String(payload?.parentSessionId || "").trim(),
      dialogProcessId: String(runConfig.resumeDialogProcessId || payload?.dialogProcessId || "").trim(),
      turnScopeId: String(runConfig.resumeTurnScopeId || payload?.turnScopeId || runConfig.turnScopeId || "").trim(),
    };
    const snapshot = await loadStoppedModelMessageSnapshot({
      globalConfig: this.globalConfig,
      identity,
    });
    const systemMessages = Array.isArray(snapshot?.messageBlocks?.system)
      ? snapshot.messageBlocks.system
      : [];
    const historyMessages = [
      ...(Array.isArray(snapshot?.messageBlocks?.history) ? snapshot.messageBlocks.history : []),
    ];
    const agentContext = await contextBuilder._buildAgentContext(
      systemMessages,
      historyMessages,
      {
        dialogProcessId: String(payload?.dialogProcessId || identity.dialogProcessId || "").trim(),
        attachments: Array.isArray(payload?.userMessageAttachments)
          ? payload.userMessageAttachments
          : [],
      },
    );
    const scopedAgentContext = this._applyRunConfigToolPolicy(agentContext, runConfig);
    const runtimeAgentContext = this.agentRuntimeFacade.buildRunTurnContext(
      scopedAgentContext,
      abortSignal,
    );
    const runtime = getRuntimeFromAgentContext(runtimeAgentContext);
    runtime.resumeFromStoppedSnapshot = true;
    runtime.resumedStoppedSnapshotIdentity = identity;
    runtime.resumedStoppedSnapshotMessageBlocks = {
      system: Array.isArray(snapshot?.messageBlocks?.system) ? snapshot.messageBlocks.system : [],
      history: Array.isArray(snapshot?.messageBlocks?.history) ? snapshot.messageBlocks.history : [],
      incremental: Array.isArray(snapshot?.messageBlocks?.incremental) ? snapshot.messageBlocks.incremental : [],
    };
    return {
      agentContext: scopedAgentContext,
      runtimeAgentContext,
    };
  }

  async _resolveExistingUserMessageAttachments({
    userId = "",
    sessionId = "",
    parentSessionId = "",
    turnScopeId = "",
    dialogProcessId = "",
  } = {}) {
    if (!userId || !sessionId || !this.session?.findById) return [];
    let sessionDoc = null;
    try {
      sessionDoc = await this.session.findById(userId, sessionId, parentSessionId);
    } catch {
      return [];
    }
    const messages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const messageItem = messages[index];
      if (String(messageItem?.role || "").trim() !== "user") continue;
      if (messageItem?.injectedMessage === true || messageItem?.pluginMessage === true) continue;
      const sameTurn = turnScopeId && String(messageItem?.turnScopeId || "").trim() === turnScopeId;
      const sameDialog = dialogProcessId && String(messageItem?.dialogProcessId || "").trim() === dialogProcessId;
      if (!sameTurn && !sameDialog) continue;
      return Array.isArray(messageItem?.attachments) ? messageItem.attachments : [];
    }
    return [];
  }

  async _enrichUserInputAttachmentsFromIndex({ userId = "", sessionId = "", attachments = [], existingAttachments = [] } = {}) {
    const sourceAttachments = Array.isArray(attachments) ? attachments : [];
    if (!sourceAttachments.length) return sourceAttachments;
    const normalizedSessionId = String(sessionId || "").trim();
    const basePath = await this._resolveAttachmentIndexBasePath(userId);
    let index = null;
    if (basePath && normalizedSessionId) {
      try {
        index = await readAttachIndex(basePath, {
          sessionId: normalizedSessionId,
          attachmentSource: "user",
        });
      } catch {
        index = null;
      }
    }
    const indexedAttachments = Object.values(index?.attachments || {}).filter(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );
    const richCandidates = [
      ...(Array.isArray(existingAttachments) ? existingAttachments : []),
      ...indexedAttachments,
    ];
    if (!richCandidates.length) return sourceAttachments;
    return sourceAttachments.map((attachmentItem) => {
      const match = findMatchingAttachmentMeta(attachmentItem, richCandidates);
      return match ? mergeAttachmentMetaPreferRich(match, attachmentItem) : attachmentItem;
    });
  }

  async _resolveAttachmentIndexBasePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return "";
    if (this.workspaceService?.ensureUserWorkspace) {
      try {
        const basePath = await this.workspaceService.ensureUserWorkspace(normalizedUserId);
        if (basePath) return String(basePath || "").trim();
      } catch {
        // fall through to globalConfig workspaceRoot
      }
    }
    const workspaceRoot = String(this.globalConfig?.workspaceRoot || "").trim();
    return workspaceRoot ? path.resolve(workspaceRoot, normalizedUserId) : "";
  }

  async _appendSessionTurn({
    userId,
    sessionId,
    role,
    content,
    type = "",
    taskId = null,
    taskStatus = null,
    tool_calls = null,
    tool_call_id = "",
    attachments = [],
    modelAlias = "",
    modelName = "",
    summarized = false,
    toolName = "",
    rawModelContent = null,
    modelAdditionalKwargs = null,
    modelResponseMetadata = null,
    dialogProcessId = "",
    parentDialogProcessId = "",
    parentSessionId = "",
    turnScopeId = "",
    eventListener,
  }) {
    await this.turnPersister.appendSessionTurn({
      userId,
      sessionId,
      role,
      content,
      type,
      taskId,
      taskStatus,
      tool_calls,
      tool_call_id,
      attachments,
      modelAlias,
      modelName,
      summarized,
      toolName,
      rawModelContent,
      modelAdditionalKwargs,
      modelResponseMetadata,
      dialogProcessId,
      parentDialogProcessId,
      parentSessionId,
      turnScopeId,
      eventListener,
    });
  }

  async _appendAgentMessages({
    userId,
    sessionId,
    parentSessionId = "",
    messages = [],
    dialogProcessId = "",
    parentDialogProcessId = "",
    turnScopeId = "",
    eventListener,
  }) {
    await this.turnPersister.appendAgentMessages({
      userId,
      sessionId,
      parentSessionId,
      messages,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId,
      eventListener,
    });
  }

  async _stampReusedUserTurnDialogProcessId(payload = {}) {
    return this.session?.stampReusedUserTurnDialogProcessId?.(payload);
  }

  async persistStoppedAssistantMessage({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    partialAssistant = {},
  } = {}) {
    return this.turnPersister.persistStoppedAssistantMessage({
      userId,
      sessionId,
      parentSessionId,
      parentDialogProcessId,
      partialAssistant,
    });
  }

  async _initializeRunSessionRuntime({
    userId,
    sessionId,
    parentSessionId = "",
    caller = CALLER_ROLE.USER,
    eventListener = null,
    turnScopeId = "",
  }) {
    return this.initializer.initializeRunSessionRuntime({
      userId,
      sessionId,
      parentSessionId,
      caller,
      eventListener,
      turnScopeId,
    });
  }

  async _finalizeRunSession({
    userId,
    sessionId,
    parentSessionId = "",
    parentDialogProcessId = "",
    caller = CALLER_ROLE.USER,
    dialogProcessId = "",
    turnScopeId = "",
    thinkingStartedAt = "",
    agentResult = {},
    executionStartIndex = 0,
    runtimeEventListener = null,
    userConfig = {},
    resolvedParentAsyncResultContainer = null,
  }) {
    return this.finalizer.finalizeRunSession({
      userId,
      sessionId,
      parentSessionId,
      parentDialogProcessId,
      caller,
      dialogProcessId,
      turnScopeId,
      thinkingStartedAt,
      agentResult,
      executionStartIndex,
      runtimeEventListener,
      userConfig,
      resolvedParentAsyncResultContainer,
    });
  }


  _mergePluginOptions(...items) {
    return this.modelMessageRuntimeHelpers.mergePluginOptions(...items);
  }

  _createPluginResolveModelMessages(payload = {}) {
    return this.modelMessageRuntimeHelpers.createResolveModelMessages(payload);
  }

  _createPluginMarkMessagesSummarized() {
    return this.modelMessageRuntimeHelpers.createMarkMessagesSummarized();
  }

  _prepareBotHookRunConfig({ runConfig = {} } = {}) {
    return this.runConfigPluginPreparer.prepareBotHookRunConfig({ runConfig });
  }

  _buildPluginRegisterApi({ manager = null, pluginName = "", options = {}, runConfig = {} } = {}) {
    return this.runConfigPluginPreparer.buildPluginRegisterApi({
      manager,
      pluginName,
      options,
      runConfig,
    });
  }

  async runSession({
    userId,
    sessionId,
    message,
    attachments = [],
    systemMessages = [],
    eventListener = null,
    caller = CALLER_ROLE.USER,
    parentSessionId = "",
    parentDialogProcessId = "",
    abortSignal = null,
    userInteractionBridge = null,
    runConfig = {},
    turnScopeId = "",
    parentAsyncResultContainer = null,
  }) {
    return this.runner.runSession({
      userId,
      sessionId,
      message,
      attachments,
      systemMessages,
      eventListener,
      caller,
      parentSessionId,
      parentDialogProcessId,
      abortSignal,
      userInteractionBridge,
      runConfig,
      turnScopeId,
      parentAsyncResultContainer,
    });
  }

  async runSessionAsUser({
    userId,
    sessionId,
    message,
    attachments = [],
    eventListener = null,
  }) {
    if (!sessionId) {
      throw recoverableToolError(tSystem("common.sessionIdRequired"), {
        code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
      });
    }
    return this.runSession({
      userId,
      sessionId,
      message,
      attachments,
      eventListener,
      caller: CALLER_ROLE.USER,
      parentSessionId: "",
    });
  }
}
