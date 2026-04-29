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
import { mapToAgentContextSchema } from "./agent-context-mapper.js";

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
    this._runtimeBasePathCache = "";
    this._workspaceDirectoriesPromise = null;
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
    if (this._runtimeBasePathCache) return this._runtimeBasePathCache;
    this._runtimeBasePathCache = resolveRuntimeBasePath({
      userId: this.userId,
      globalConfig: this.globalConfig,
    });
    return this._runtimeBasePathCache;
  }

  async _resolveWorkspaceDirectoriesCached(runtimeBasePath = "") {
    if (!this._workspaceDirectoriesPromise) {
      this._workspaceDirectoriesPromise = resolveWorkspaceDirectories(runtimeBasePath);
    }
    return this._workspaceDirectoriesPromise;
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
      workspaceDirectories: await this._resolveWorkspaceDirectoriesCached(
        resolvedBasePath,
      ),
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

    const agentContext = mapToAgentContextSchema({
      staticAgentContext,
      runtime,
      dialogProcessId,
      resolvedRootSessionId,
      resolvedSessionTree,
      sessionId: this.sessionId,
      parentSessionId: this.parentSessionId,
      caller: this.caller,
      now: this._now(),
      systemMessages,
      conversationMessages,
      globalConfig: this.globalConfig,
    });
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
        this._resolveWorkspaceDirectoriesCached(runtimeBasePath),
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
