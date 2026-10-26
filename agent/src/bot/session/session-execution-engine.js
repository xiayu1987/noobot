/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AgentContextFactory, AgentRuntimeFacade } from "../../runtime/index.js";
import { SessionExecutionInitializer } from "../execution/initializer.js";
import { SessionExecutionFinalizer } from "../execution/finalizer.js";
import { SessionTurnPersister } from "../execution/turn-persister.js";
import { SessionExecutionRunner } from "../execution/runner.js";
import { BotManageValidator } from "../config/validator.js";
import { mergeRunConfigPluginPolicy, RunConfigResolver } from "@noobot/agent-config-protocol";
import { MemoryPostProcessService } from "../execution/memory-postprocess.js";
import { createDetachedSubSessionRunner } from "./detached-subsession-runner.js";
import { ModelMessageRuntimeHelpers } from "./model-message-runtime-helpers.js";
import { createRunConfigPluginPreparer } from "./session-plugin-runtime-adapter.js";
import { prepareTurnInput, prepareAgentTurnExecution } from "./turn-execution-preparer.js";
import { isFunction } from "@noobot/shared/value";
import { commitSummaryCheckpoint } from "./summary-checkpoint-committer.js";

const ENGINE_DEPENDENCY_FIELDS = Object.freeze([
  "globalConfig",
  "session",
  "memory",
  "attach",
  "skill",
  "configService",
  "workspaceService",
  "errorLogger",
  "botManager",
  "agentRunner",
  "pluginRuntimeBundle",
]);

function assertEngineDependencies(dependencies) {
  const missing = ENGINE_DEPENDENCY_FIELDS.filter(
    (field) => dependencies?.[field] === undefined || dependencies[field] === null,
  );
  if (missing.length) {
    throw new TypeError(`SessionExecutionEngine requires: ${missing.join(",")}`);
  }
  if (!isFunction(dependencies.agentRunner)) {
    throw new TypeError("SessionExecutionEngine agentRunner must be a function");
  }
  const { loadedPlugins, pluginRuntime } = dependencies.pluginRuntimeBundle;
  if (!loadedPlugins || !pluginRuntime) {
    throw new TypeError(
      "SessionExecutionEngine pluginRuntimeBundle requires loadedPlugins,pluginRuntime",
    );
  }
}

export class SessionExecutionEngine {
  constructor(dependencies) {
    assertEngineDependencies(dependencies);
    this._assignCoreDependencies(dependencies);
    this._initializeCoreServices();
    this._initializeRuntimeServices();
    this._initializeExecutionServices();
    this.runner = this._createRunner();
  }

  _assignCoreDependencies({
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
  }) {
    this.globalConfig = globalConfig;
    this.session = session;
    this.memory = memory;
    this.attach = attach;
    this.skill = skill;
    this.configService = configService;
    this.workspaceService = workspaceService;
    this.errorLogger = errorLogger;
    this.botManager = botManager;
    this.agentRunner = agentRunner;
    this.pluginRuntimeBundle = pluginRuntimeBundle;
  }

  _initializeCoreServices() {
    this.validator = new BotManageValidator();
    this.runConfigResolver = new RunConfigResolver({
      globalConfig: this.globalConfig,
    });
    this.memoryPostProcessService = new MemoryPostProcessService({
      globalConfig: this.globalConfig,
      session: this.session,
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
      memoryPostProcessService: this.memoryPostProcessService,
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
      errorLogger: this.errorLogger,
    });
  }

  _createRunConfigPluginPreparer() {
    return createRunConfigPluginPreparer({
      loadedPlugins: this.pluginRuntimeBundle.loadedPlugins,
      globalConfig: this.globalConfig,
      workspaceService: this.workspaceService,
      createPluginResolveModelMessages: () =>
        this.modelMessageRuntimeHelpers.createResolveModelMessages(),
      createDetachedSubSessionRunner: () => this._createDetachedSubSessionRunner(),
    });
  }

  _createRunner() {
    const runnerValidationDeps = {
      normalizeRunMessage: (message) => this._normalizeRunMessage(message),
      validateRunInput: (payload) => this._validateRunInput(payload),
    };
    const runnerRuntimeDeps = {
      initializeRunSessionRuntime: (payload) => this._initializeRunSessionRuntime(payload),
      resolveScenarioRunConfig: (runConfig = {}, userConfig = {}) =>
        this._resolveScenarioRunConfig(runConfig, userConfig),
      prepareRunConfig: (payload = {}) => this._prepareRunConfig(payload),
      buildContextBuilder: (payload) => this._buildContextBuilder(payload),
      prepareTurnInput: ({ buildContextPayload }) =>
        prepareTurnInput({ attachmentService: this.attach, buildContextPayload }),
      prepareAgentTurnExecution: (payload = {}) => this._prepareAgentTurnExecution(payload),
      commitSummaryCheckpoint: (payload = {}) =>
        commitSummaryCheckpoint({
          session: this.session,
          turnPersister: this.turnPersister,
          ...payload,
        }),
    };
    const runnerPersistenceDeps = {
      appendAgentMessages: (payload = {}) => this._appendAgentMessages(payload),
      bindSessionTurnAttachments: (payload = {}) => this.session.bindTurnAttachments(payload),
      assertReusedUserTurnIdentity: (payload = {}) => this._assertReusedUserTurnIdentity(payload),
      getSessionTurns: (payload = {}) => this.session.getSessionTurns(payload),
      getTurnSummaryCheckpointState: (payload = {}) =>
        this.session.getTurnSummaryCheckpointState(payload),
      finalizeRunSession: (payload) => this._finalizeRunSession(payload),
      saveExecutionReport: (payload = {}) => this.session.saveExecutionReport(payload),
      getExecutionTurnLogs: (payload = {}) => this.session.getExecutionTurnLogs(payload),
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

  _normalizeRunMessage(message) {
    return this.validator.normalizeRunMessage(message);
  }

  _validateRunInput({ userId, sessionId, caller, parentSessionId }) {
    this.validator.validateRunInput({
      userId,
      sessionId,
      caller,
      parentSessionId,
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

  async resolveExecutionIntent({ userId = "", runConfig = {}, turnScopeId = "" } = {}) {
    const basePath = await this.workspaceService.ensureUserWorkspace(userId);
    const userConfig = await this.configService.loadUserConfig(basePath);
    const scenarioResolvedRunConfig = this._resolveScenarioRunConfig(runConfig, userConfig);
    return this.runConfigPluginPreparer.resolveExecutionIntent({
      userId,
      runConfig: scenarioResolvedRunConfig,
      userConfig,
      turnScopeId,
    });
  }

  _mergeRunConfigPluginPolicy({
    baseRunConfig = {},
    runConfigPatch = {},
    disabledPlugins = [],
  } = {}) {
    return mergeRunConfigPluginPolicy({
      baseRunConfig,
      runConfigPatch,
      disabledPlugins,
    });
  }

  _createDetachedSubSessionRunner() {
    return createDetachedSubSessionRunner({
      workspaceService: this.workspaceService,
      configService: this.configService,
      sessionRunner: this.runner,
      session: this.session,
      attachmentService: this.attach,
      pluginRuntime: this.pluginRuntimeBundle.pluginRuntime,
      mergeRunConfigPluginPolicy: (payload = {}) => this._mergeRunConfigPluginPolicy(payload),
      prepareRunConfig: (payload = {}) => this._prepareRunConfig(payload),
    });
  }

  async runDetachedSubSession(payload = {}) {
    return this._createDetachedSubSessionRunner()(payload);
  }

  _buildContextBuilder({
    runtimeIdentity,
    userConfig,
    userMessageAttachments,
    systemMessages,
    eventListener,
    userInteractionBridge,
    runConfig,
    abortSignal,
    persistenceScope,
  }) {
    return this.agentContextFactory.buildContextBuilder({
      runtimeIdentity,
      userConfig,
      userMessageAttachments,
      systemMessages,
      eventListener,
      userInteractionBridge,
      runConfig,
      abortSignal,
      persistenceScope,
    });
  }

  async _prepareAgentTurnExecution({ buildContextPayload }) {
    return prepareAgentTurnExecution(this, { buildContextPayload });
  }

  async _appendAgentMessages({
    userId,
    sessionId,
    messages = [],
    dialogProcessId = "",
    parentDialogProcessId = "",
    turnScopeId = "",
    eventListener,
    persistenceScope,
  }) {
    return this.turnPersister.appendAgentMessages({
      userId,
      sessionId,
      messages,
      dialogProcessId,
      parentDialogProcessId,
      turnScopeId,
      eventListener,
      persistenceScope,
    });
  }

  async _assertReusedUserTurnIdentity(payload = {}) {
    return this.session.assertReusedUserTurnIdentity(payload);
  }

  async _initializeRunSessionRuntime(payload) {
    return this.initializer.initializeRunSessionRuntime(payload);
  }

  async _finalizeRunSession(payload) {
    return this.finalizer.finalizeRunSession(payload);
  }

  async runSession(payload) {
    return this.runner.runSession(payload);
  }
}
