/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../config/index.js";
import { buildTools } from "../tools/index.js";
import { getConnectorChannelStore } from "../connectors/channel-store.js";
import { getConnectorHistoryStore } from "../connectors/history-store.js";
import {
  buildDynamicInfo,
  buildStaticInfo,
  loadSystemPrompt,
  resolveAllEnabledProviders,
  resolveAttachments,
  resolveAvailableMcpServers,
  resolveConnectorStatusSection,
  resolveLongMemory,
  resolveModelSection,
  resolveRuntimeBasePath,
  resolveServices,
  resolveSessionTreeWithRootSessionId,
  resolveSkills,
  resolveWorkspaceDirectories,
  toConversationMessages,
} from "./data-providers.js";
import {
  buildRuntimeContext,
  initializeRuntimeEnvironment,
} from "./runtime-environment-builder.js";
import { composeSystemInfoSections } from "./system-prompt-formatter.js";

export class ContextBuilder {
  constructor(input = {}) {
    const hasContainerShape =
      input &&
      typeof input === "object" &&
      input.config &&
      input.serviceContainer &&
      input.sessionContext;
    if (!hasContainerShape) {
      throw new Error(
        "ContextBuilder requires container input: { config, serviceContainer, sessionContext }",
      );
    }
    const normalized = {
      ...(input?.config || {}),
      ...(input?.serviceContainer || {}),
      ...(input?.sessionContext || {}),
    };
    const {
      globalConfig,
      userConfig = {},
      eventListener = null,
      userId = "",
      sessionId = "",
      caller = "user",
      parentSessionId = "",
      attachmentMetas = [],
      sessionManager,
      memoryService,
      attachmentService,
      skillService,
      botManager = null,
      userInteractionBridge = null,
      runConfig = {},
      abortSignal = null,
      parentAsyncResultContainer = null,
    } = normalized;
    this.globalConfig = globalConfig;
    this.userConfig = userConfig;
    this.eventListener = eventListener;
    this.userId = userId;
    this.sessionId = sessionId;
    this.caller = caller;
    this.parentSessionId = parentSessionId;
    this.attachmentMetas = attachmentMetas;
    this.sessionManager = sessionManager;
    this.memoryService = memoryService;
    this.attachmentService = attachmentService;
    this.skillService = skillService;
    this.botManager = botManager;
    this.userInteractionBridge = userInteractionBridge;
    this.runConfig = runConfig;
    this.abortSignal = abortSignal;
    this.parentAsyncResultContainer = parentAsyncResultContainer;
    this._effectiveConfigCache = null;
  }

  _now() {
    return new Date().toISOString();
  }

  _getEffectiveConfig() {
    if (this._effectiveConfigCache) return this._effectiveConfigCache;
    this._effectiveConfigCache = mergeConfig(this.globalConfig, this.userConfig);
    return this._effectiveConfigCache;
  }

  _resolveRuntimeBasePath() {
    return resolveRuntimeBasePath({
      userId: this.userId,
      globalConfig: this.globalConfig,
    });
  }

  async _buildStaticAgentContext({ runtimeBasePath = "" } = {}) {
    const staticInfo = buildStaticInfo({
      runtimeBasePath,
      userId: this.userId,
      globalConfig: this.globalConfig,
    });
    const resolvedBasePath = staticInfo.basePath || runtimeBasePath || "";
    return {
      cwd: staticInfo.cwd || process.cwd(),
      userId: staticInfo.userId || "",
      basePath: resolvedBasePath,
      platform: staticInfo.platform || process.platform,
      arch: staticInfo.arch || process.arch,
      nodeVersion: staticInfo.nodeVersion || process.version,
      timezone:
        staticInfo.timezone ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "",
      globalDefaults: staticInfo.globalDefaults || {
        workspaceRoot: this.globalConfig?.workspaceRoot || "",
      },
      workspaceDirectories: await resolveWorkspaceDirectories(resolvedBasePath),
    };
  }

  _buildSystemRuntime({
    dialogProcessId = "",
    sessionTree = {},
    rootSessionId = "",
  } = {}) {
    return buildDynamicInfo({
      sessionId: this.sessionId,
      caller: this.caller,
      dialogProcessId,
      sessionTree,
      runConfig: this.runConfig,
      now: this._now(),
      rootSessionId,
      parentSessionId: this.parentSessionId,
    });
  }

  async _buildAgentContext(
    systemMessages,
    conversationMessages,
    {
      runtimeBasePath = "",
      dialogProcessId = "",
      sessionTree = null,
      rootSessionId = "",
      attachmentMetas = [],
    } = {},
  ) {
    const resolvedRuntimeBasePath =
      runtimeBasePath || this._resolveRuntimeBasePath();
    const { sessionTree: resolvedSessionTree, rootSessionId: resolvedRootSessionId } =
      sessionTree && typeof sessionTree === "object" && String(rootSessionId || "").trim()
        ? {
            sessionTree,
            rootSessionId: String(rootSessionId || "").trim(),
          }
        : await resolveSessionTreeWithRootSessionId({
            runtimeBasePath: resolvedRuntimeBasePath,
            sessionManager: this.sessionManager,
            userId: this.userId,
            sessionId: this.sessionId,
            now: this._now(),
          });

    const staticAgentContext = await this._buildStaticAgentContext({
      runtimeBasePath: resolvedRuntimeBasePath,
    });
    const effectiveConfig = this._getEffectiveConfig();
    const runtime = buildRuntimeContext({
      userId: this.userId,
      basePath: resolvedRuntimeBasePath,
      globalConfig: this.globalConfig,
      userConfig: this.userConfig,
      eventListener: this.eventListener,
      sessionManager: this.sessionManager,
      attachmentService: this.attachmentService,
      botManager: this.botManager,
      userInteractionBridge: this.userInteractionBridge,
      abortSignal: this.abortSignal,
      runtimeModel: String(this.runConfig?.runtimeModel || "").trim(),
      allEnabledProviders: resolveAllEnabledProviders(effectiveConfig),
      parentAsyncResultContainer: this.parentAsyncResultContainer,
      runConfig: this.runConfig,
      systemRuntime: this._buildSystemRuntime({
        dialogProcessId,
        sessionTree: resolvedSessionTree,
        rootSessionId: resolvedRootSessionId,
      }),
      attachmentMetas,
    });
    await initializeRuntimeEnvironment(runtime);

    const systemRuntime = runtime?.systemRuntime || {};
    const selectedConnectorsSource =
      systemRuntime?.config?.selectedConnectors &&
      typeof systemRuntime.config.selectedConnectors === "object"
        ? systemRuntime.config.selectedConnectors
        : {};
    const selectedConnectors = Object.fromEntries(
      Object.entries(selectedConnectorsSource)
        .map(([connectorType, connectorName]) => [
          String(connectorType || "").trim(),
          String(connectorName || "").trim(),
        ])
        .filter(([connectorType]) => Boolean(connectorType)),
    );
    const agentContext = {
      environment: {
        os: {
          platform: staticAgentContext.platform || process.platform,
          arch: staticAgentContext.arch || process.arch,
          timezone:
            staticAgentContext.timezone ||
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            "",
          nodeVersion: staticAgentContext.nodeVersion || process.version,
        },
        workspace: {
          cwd: staticAgentContext.cwd || process.cwd(),
          basePath: staticAgentContext.basePath || "",
          workspaceDirectories: Array.isArray(staticAgentContext.workspaceDirectories)
            ? staticAgentContext.workspaceDirectories
            : [],
          globalDefaults:
            staticAgentContext.globalDefaults &&
            typeof staticAgentContext.globalDefaults === "object"
              ? staticAgentContext.globalDefaults
              : { workspaceRoot: this.globalConfig?.workspaceRoot || "" },
        },
        identity: {
          userId: staticAgentContext.userId || this.userId || "",
        },
      },
      execution: {
        dialogProcessId: String(systemRuntime?.dialogProcessId || dialogProcessId || "").trim(),
        timestamp: String(systemRuntime?.now || this._now()).trim(),
        flags: {
          allowUserInteraction: systemRuntime?.config?.allowUserInteraction !== false,
          maxToolLoopTurns: Number(systemRuntime?.config?.maxToolLoopTurns || 0),
        },
        models: {
          runtimeModel: String(runtime?.runtimeModel || "").trim(),
          allEnabledProviders:
            runtime?.allEnabledProviders &&
            typeof runtime.allEnabledProviders === "object"
              ? runtime.allEnabledProviders
              : {},
        },
        controllers: {
          abortSignal: runtime?.abortSignal || null,
          parentAsyncResultContainer: runtime?.parentAsyncResultContainer || null,
          runtime,
        },
      },
      session: {
        root: {
          id: String(systemRuntime?.rootSessionId || resolvedRootSessionId || "").trim(),
          tree: systemRuntime?.sessionTree || resolvedSessionTree || {},
          sharedState: {},
        },
        parent: {
          id: String(systemRuntime?.parentSessionId || this.parentSessionId || "").trim(),
          caller: String(systemRuntime?.caller || this.caller || "user").trim(),
        },
        current: {
          id: String(systemRuntime?.sessionId || this.sessionId || "").trim(),
          attachments: Array.isArray(runtime?.attachmentMetas)
            ? runtime.attachmentMetas
            : [],
          connectors: selectedConnectors,
          turnStore: {
            currentTurnMessages: runtime?.currentTurnMessages || null,
            currentTurnTasks: runtime?.currentTurnTasks || null,
          },
        },
      },
      payload: {
        messages: {
          system: Array.isArray(systemMessages) ? systemMessages : [],
          history: Array.isArray(conversationMessages) ? conversationMessages : [],
        },
        tools: {
          registry: [],
          shared: runtime?.sharedTools || {},
        },
      },
    };
    const builtTools = await buildTools({
      sessionId: this.sessionId || "",
      parentSessionId: this.parentSessionId || "",
      agentContext: {
        ...agentContext,
        runtime,
      },
    });
    agentContext.payload.tools.registry = Array.isArray(builtTools)
      ? builtTools
      : [];
    return agentContext;
  }

  async _resolveSessionRecords({ sessionId } = {}) {
    const resolvedSessionId = sessionId || this.sessionId || "";
    const runtimeBasePath = this._resolveRuntimeBasePath();
    if (!this.sessionManager || !runtimeBasePath || !resolvedSessionId)
      return [];
    return this.sessionManager.getContextRecords({
      userId: this.userId,
      sessionId: resolvedSessionId,
      userConfig: this.userConfig,
    });
  }

  async _buildSystemContext({ dialogProcessId = "", longMemory = null } = {}) {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    const effectiveConfig = this._getEffectiveConfig();
    const [systemPrompt, skills, attachmentMetas, workspaceDirectories, treeInfo] =
      await Promise.all([
        loadSystemPrompt(),
        resolveSkills({
          skillService: this.skillService,
          runtimeBasePath,
          userId: this.userId,
        }),
        resolveAttachments({
          attachmentService: this.attachmentService,
          runtimeBasePath,
          effectiveConfig,
          attachmentMetas: this.attachmentMetas,
          userId: this.userId,
          sessionId: this.sessionId,
        }),
        resolveWorkspaceDirectories(runtimeBasePath),
        resolveSessionTreeWithRootSessionId({
          runtimeBasePath,
          sessionManager: this.sessionManager,
          userId: this.userId,
          sessionId: this.sessionId,
          now: this._now(),
        }),
      ]);
    const services = resolveServices(effectiveConfig);
    const mcpServers = resolveAvailableMcpServers(effectiveConfig);
    const modelSection = resolveModelSection({
      globalConfig: this.globalConfig,
      userConfig: this.userConfig,
      effectiveConfig,
    });
    const connectorStatusSection = await resolveConnectorStatusSection({
      rootSessionId: treeInfo.rootSessionId,
      userId: this.userId,
      selectedConnectors:
        this.runConfig?.selectedConnectors &&
        typeof this.runConfig.selectedConnectors === "object"
          ? this.runConfig.selectedConnectors
          : {},
      connectorChannelStore: getConnectorChannelStore(),
      connectorHistoryStore: getConnectorHistoryStore(),
    });

    const staticInfo = buildStaticInfo({
      runtimeBasePath,
      userId: this.userId,
      globalConfig: this.globalConfig,
    });
    const dynamicInfo = this._buildSystemRuntime({
      dialogProcessId,
      sessionTree: treeInfo.sessionTree,
      rootSessionId: treeInfo.rootSessionId,
    });
    const systemContext = composeSystemInfoSections({
      systemPrompt,
      staticInfo,
      dynamicInfo,
      longMemory,
      workspaceDirectories,
      modelSection,
      skills,
      services,
      mcpServers,
      attachmentMetas,
      connectorStatusSection,
    });
    return {
      systemContext,
      runtimeBasePath,
      sessionTree: treeInfo.sessionTree,
      rootSessionId: treeInfo.rootSessionId,
      attachmentMetas,
    };
  }

  async buildInitialContext({ dialogProcessId = "" } = {}) {
    const {
      systemContext,
      runtimeBasePath,
      sessionTree,
      rootSessionId,
      attachmentMetas,
    } = await this._buildSystemContext({ dialogProcessId });
    return this._buildAgentContext(systemContext, [], {
      runtimeBasePath,
      dialogProcessId,
      sessionTree,
      rootSessionId,
      attachmentMetas,
    });
  }

  async buildContinueContext({ dialogProcessId = "" } = {}) {
    const sessionRecords = await this._resolveSessionRecords({
      sessionId: this.sessionId || "",
    });
    const longMemory = await resolveLongMemory({
      memoryService: this.memoryService,
      runtimeBasePath: this._resolveRuntimeBasePath(),
      userId: this.userId,
    });
    const {
      systemContext,
      runtimeBasePath,
      sessionTree,
      rootSessionId,
      attachmentMetas,
    } = await this._buildSystemContext({ dialogProcessId, longMemory });
    return this._buildAgentContext(
      systemContext,
      toConversationMessages(sessionRecords),
      {
        runtimeBasePath,
        dialogProcessId,
        sessionTree,
        rootSessionId,
        attachmentMetas,
      },
    );
  }
}
