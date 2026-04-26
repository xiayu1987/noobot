/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { mergeConfig } from "../config/index.js";
import { resolveDefaultModelSpec } from "../model/index.js";
import { buildTools } from "../tools/index.js";
import { initRuntimeSharedBrowser } from "../utils/web-browser-simulate.js";
import {
  cleanAndDedupTextLines,
  extractReadableTextFromHtml,
  extractVisibleTextFromHtml,
} from "../utils/web-text-cleaner.js";
import { cleanTextUniversal } from "../utils/text-cleaner.js";
import {
  decryptPayloadBySessionId,
  encryptPayloadBySessionId,
} from "../utils/session-crypto.js";
import { getConnectorChannelStore } from "../connectors/channel-store.js";
import {
  createCurrentTurnMessagesStore,
  createCurrentTurnTasksStore,
} from "./current-turn-store.js";

function toSystemSection(title, content) {
  return `# ${title}\n${content}`;
}

function hasLongMemoryValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function defaultSharedFetch(url, init = {}) {
  return await globalThis.fetch(url, init);
}

function createDefaultTextCleaner() {
  return {
    cleanUniversal(input = "", options = {}) {
      return cleanTextUniversal(input, options || {});
    },
    cleanText(input = "", maxLines = 4000) {
      return cleanAndDedupTextLines(String(input || ""), maxLines);
    },
    cleanHtml(input = "", { url = "", readable = false } = {}) {
      const html = String(input || "");
      if (!html) return "";
      if (readable) {
        return (
          extractReadableTextFromHtml(html, String(url || "")) ||
          extractVisibleTextFromHtml(html)
        );
      }
      return extractVisibleTextFromHtml(html);
    },
    cleanAny(input = "", { contentType = "", url = "" } = {}) {
      return cleanTextUniversal(String(input || ""), {
        format: "auto",
        contentType: String(contentType || ""),
        url: String(url || ""),
        maxChars: 200000,
      });
    },
  };
}

export class ContextBuilder {
  constructor({
    globalConfig,
    userConfig = {},
    eventListener = null,
    userId = "",
    sessionId = "",
    caller = "user",
    parentSessionId = "",
    attachments = [],
    sessionManager,
    memoryService,
    attachmentService,
    skillService,
    botManager = null,
    userInteractionBridge = null,
    runConfig = {},
    abortSignal = null,
    parentAsyncResultContainer = null,
  }) {
    this.globalConfig = globalConfig;
    this.userConfig = userConfig;
    this.eventListener = eventListener;
    this.userId = userId;
    this.sessionId = sessionId;
    this.caller = caller;
    this.parentSessionId = parentSessionId;
    this.attachments = attachments;
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

  async getSystemPrompt() {
    return readFile("./system-core/system-prompt/base.md", "utf8");
  }

  _resolveBasePath() {
    if (!this.userId) return "";
    const workspaceRoot = this.globalConfig?.workspaceRoot || "";
    if (!workspaceRoot) return "";
    return path.resolve(workspaceRoot, this.userId);
  }

  _resolveRuntimeBasePath() {
    return this._resolveBasePath();
  }

  _now() {
    return new Date().toISOString();
  }

  _getEffectiveConfig() {
    if (this._effectiveConfigCache) return this._effectiveConfigCache;
    this._effectiveConfigCache = mergeConfig(
      this.globalConfig,
      this.userConfig,
    );
    return this._effectiveConfigCache;
  }

  _isUserInteractionAllowed() {
    return this.runConfig?.allowUserInteraction !== false;
  }

  async _buildStaticAgentContext({ runtimeBasePath = "" } = {}) {
    const staticInfo = this._buildStaticInfo({ runtimeBasePath });
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
      workspaceDirectories:
        await this._resolveWorkspaceDirectories(resolvedBasePath),
    };
  }

  async _resolveSessionTree({ runtimeBasePath = "" } = {}) {
    const resolvedRuntimeBasePath =
      runtimeBasePath || this._resolveRuntimeBasePath();
    if (!resolvedRuntimeBasePath || !this.sessionManager?.getSessionTree) {
      return { roots: [], nodes: {}, updatedAt: this._now() };
    }
    return this.sessionManager.getSessionTree({ userId: this.userId });
  }

  async _resolveWorkspaceDirectories(runtimeBasePath = "") {
    const basePath = String(runtimeBasePath || "").trim();
    if (!basePath) return [];
    try {
      await access(basePath);
    } catch {
      return [];
    }

    const directories = new Set();
    let level1Entries = [];
    try {
      level1Entries = await readdir(basePath, { withFileTypes: true });
    } catch {
      return [];
    }

    for (const entry of level1Entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      directories.add(entry.name);
    }

    const runtimeDirPath = path.join(basePath, "runtime");
    try {
      await access(runtimeDirPath);
      let runtimeLevel1Entries = [];
      try {
        runtimeLevel1Entries = await readdir(runtimeDirPath, {
          withFileTypes: true,
        });
      } catch {
        runtimeLevel1Entries = [];
      }
      for (const entry of runtimeLevel1Entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        directories.add(path.posix.join("runtime", entry.name));
      }
    } catch {}

    return Array.from(directories).sort((leftDir, rightDir) =>
      leftDir.localeCompare(rightDir),
    );
  }

  _buildRuntimeContext({ dialogProcessId, sessionTree, rootSessionId = "" }) {
    const normalizedDialogProcessId = String(dialogProcessId || "");
    const configuredMaxToolLoopTurns = Number(
      this.runConfig?.maxToolLoopTurns,
    );
    const resolvedMaxToolLoopTurns =
      Number.isFinite(configuredMaxToolLoopTurns) &&
      configuredMaxToolLoopTurns > 0
        ? Math.floor(configuredMaxToolLoopTurns)
        : 0;
    const passthroughSharedTools =
      this.runConfig?.sharedTools &&
      typeof this.runConfig.sharedTools === "object"
        ? this.runConfig.sharedTools
        : {};
    const systemRuntime = {
      sessionId: this.sessionId || "",
      rootSessionId: String(rootSessionId || this.sessionId || "").trim(),
      caller: this.caller || "user",
      parentSessionId: this.parentSessionId || "",
      dialogProcessId: normalizedDialogProcessId,
      sessionTree,
      now: this._now(),
      config: {
        allowUserInteraction: this._isUserInteractionAllowed(),
        ...(resolvedMaxToolLoopTurns > 0
          ? { maxToolLoopTurns: resolvedMaxToolLoopTurns }
          : {}),
      },
    };

    return {
      globalConfig: this.globalConfig,
      userConfig: this.userConfig,
      eventListener: this.eventListener,
      sessionManager: this.sessionManager,
      botManager: this.botManager,
      userInteractionBridge: this.userInteractionBridge,
      abortSignal: this.abortSignal || null,
      runtimeModel: String(this.runConfig?.runtimeModel || "").trim(),
      allEnabledProviders: this._resolveAllEnabledProviders(),
      sharedTools: passthroughSharedTools,
      childAsyncResultContainers: [],
      parentAsyncResultContainer:
        this.parentAsyncResultContainer &&
        typeof this.parentAsyncResultContainer === "object"
          ? this.parentAsyncResultContainer
          : null,
      systemRuntime,
      currentTurnMessages: createCurrentTurnMessagesStore(),
      currentTurnTasks: createCurrentTurnTasksStore(),
    };
  }

  async _initializeSharedTools(runtimeContext = {}) {
    if (!isPlainObject(runtimeContext)) return;
    const sharedTools = isPlainObject(runtimeContext.sharedTools)
      ? runtimeContext.sharedTools
      : {};
    runtimeContext.sharedTools = sharedTools;
    const sessionId = String(runtimeContext?.systemRuntime?.sessionId || "").trim();
    const rootSessionId = String(
      runtimeContext?.systemRuntime?.rootSessionId || sessionId || "",
    ).trim();

    if (typeof sharedTools.fetch !== "function") {
      sharedTools.fetch =
        typeof globalThis.fetch === "function" ? defaultSharedFetch : null;
    }

    const defaultTextCleaner = createDefaultTextCleaner();
    const currentTextCleaner = isPlainObject(sharedTools.textCleaner)
      ? sharedTools.textCleaner
      : {};
    sharedTools.textCleaner = {
      ...defaultTextCleaner,
      ...currentTextCleaner,
    };
    sharedTools.sessionCrypto = {
      encryptBySessionId(payload = {}, sid = sessionId) {
        return encryptPayloadBySessionId(payload, String(sid || sessionId || ""));
      },
      decryptBySessionId(cipherText = "", sid = sessionId) {
        return decryptPayloadBySessionId(
          String(cipherText || ""),
          String(sid || sessionId || ""),
        );
      },
    };
    const connectorChannelStore = getConnectorChannelStore();
    sharedTools.connectorChannelStore = connectorChannelStore;
    runtimeContext.connectorChannels = rootSessionId
      ? connectorChannelStore.getSessionConnectors(rootSessionId)
      : { databases: [], terminals: [] };

    try {
      await initRuntimeSharedBrowser(runtimeContext);
    } catch (error) {
      sharedTools.browser = null;
      sharedTools.browserInitError = error?.message || String(error);
    }
  }

  async _buildAgentContext(
    systemMessages,
    conversationMessages,
    { runtimeBasePath = "", dialogProcessId = "" } = {},
  ) {
    const resolvedRuntimeBasePath =
      runtimeBasePath || this._resolveRuntimeBasePath();
    const sessionTree = await this._resolveSessionTree({
      runtimeBasePath: resolvedRuntimeBasePath,
    });
    const rootSessionId =
      this.sessionManager?.getRootSessionId &&
      this.userId &&
      this.sessionId
        ? await this.sessionManager.getRootSessionId({
            userId: this.userId,
            sessionId: this.sessionId,
            sessionTree,
          })
        : this.sessionId;
    const staticAgentContext = await this._buildStaticAgentContext({
      runtimeBasePath: resolvedRuntimeBasePath,
    });
    const agentContext = {
      ...staticAgentContext,
      systemMessages,
      conversationMessages,
      runtime: this._buildRuntimeContext({
        dialogProcessId,
        sessionTree,
        rootSessionId,
      }),
    };
    await this._initializeSharedTools(agentContext.runtime);
    agentContext.tools = await buildTools({
      sessionId: this.sessionId || "",
      parentSessionId: this.parentSessionId || "",
      agentContext,
    });
    return agentContext;
  }

  async _resolveAttachments() {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    if (!this.attachmentService || !runtimeBasePath) return [];
    const hasIngestedRecords = (this.attachments || []).some(
      (attachmentItem) =>
        String(attachmentItem?.attachmentId || "").trim() &&
        String(attachmentItem?.path || "").trim(),
    );
    if (hasIngestedRecords) {
      return (this.attachments || []).map((attachmentItem) => ({
        attachmentId: String(attachmentItem?.attachmentId || ""),
        name: String(attachmentItem?.name || ""),
        mimeType: String(
          attachmentItem?.mimeType || "application/octet-stream",
        ),
        size: Number(attachmentItem?.size || 0),
        path: String(attachmentItem?.path || ""),
        relativePath: String(attachmentItem?.relativePath || ""),
      }));
    }
    return this.attachmentService.ingest({
      userId: this.userId,
      attachments: this.attachments,
    });
  }

  async _resolveSkills() {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    if (!this.skillService || !runtimeBasePath) return [];
    return this.skillService.listSkills({ userId: this.userId });
  }

  async _resolveLongMemory() {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    if (!this.memoryService || !runtimeBasePath) return [];
    return this.memoryService.readLongMemory({ userId: this.userId });
  }

  _resolveServices() {
    const effectiveConfig = this._getEffectiveConfig();
    const services = effectiveConfig?.services || {};
    const serviceEndpointList = [];
    for (const [serviceName, serviceConfig] of Object.entries(services)) {
      const enabled = serviceConfig?.enabled !== false;
      if (!enabled) continue;
      const endpoints = serviceConfig?.endpoints || {};
      for (const [endpointName, endpointCfg] of Object.entries(endpoints)) {
        serviceEndpointList.push({
          serviceName,
          endpointName,
          description: endpointCfg?.description || "",
          url: endpointCfg?.url || "",
          handler: serviceConfig?.handler || "",
          query_string_format: endpointCfg?.query_string_format || "",
          body_format: endpointCfg?.body_format || "",
          custom_param_format: endpointCfg?.custom_param_format || "",
        });
      }
    }
    return serviceEndpointList;
  }

  _resolveAvailableMcpServers() {
    const effectiveConfig = this._getEffectiveConfig();
    const servers = effectiveConfig?.mcpServers || {};
    return Object.entries(servers)
      .filter(([, serverCfg]) => serverCfg?.isActive !== false)
      .map(([name, serverCfg]) => ({
        name,
        type: String(serverCfg?.type || ""),
        description: String(serverCfg?.description || ""),
      }));
  }

  _resolveCurrentModelInfo() {
    const modelSpec =
      resolveDefaultModelSpec({
        globalConfig: this.globalConfig,
        userConfig: this.userConfig,
      }) || {};
    return {
      alias: modelSpec?.alias || "",
      name: modelSpec?.model || "",
      description: modelSpec?.description || "",
    };
  }

  _resolveAvailableModels() {
    const effectiveConfig = this._getEffectiveConfig();
    const providers = effectiveConfig?.providers || {};
    return Object.entries(providers)
      .filter(([, cfg]) => cfg?.enabled !== false)
      .map(([alias, cfg]) => ({
        alias,
        name: cfg?.model || "",
        description: cfg?.description || "",
      }));
  }

  _resolveAllEnabledProviders() {
    const effectiveConfig = this._getEffectiveConfig();
    const providers = effectiveConfig?.providers || {};
    return Object.fromEntries(
      Object.entries(providers).filter(([, cfg]) => cfg?.enabled !== false),
    );
  }

  _resolveModelSection() {
    return {
      current: this._resolveCurrentModelInfo(),
      available: this._resolveAvailableModels(),
    };
  }

  _toConversationMessages(sessionRecords = []) {
    return (sessionRecords || []).map((item) => ({
      role: item.role || "user",
      content: item.content || "",
      type: item.type || "",
      tool_calls: Array.isArray(item.tool_calls) ? item.tool_calls : [],
      tool_call_id: item.tool_call_id || "",
      attachmentIds: Array.isArray(item.attachmentIds)
        ? item.attachmentIds
        : [],
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
    }));
  }

  _buildWorkspaceDirectorySection(workspaceDirectories = []) {
    const descriptions = {
      runtime: "运行时数据根目录",
      "runtime/attach": "附件文件与附件索引（attachments.json）",
      "runtime/session": "会话与执行记录",
      "runtime/workspace": "脚本执行与中间产物工作区",
      "runtime/memory": "短期/长期记忆数据",
      skills: "技能目录",
    };
    const directoryItems = (workspaceDirectories || []).map((dirPath) => ({
      path: dirPath,
      description: descriptions[dirPath] || "用户工作区目录",
    }));
    return JSON.stringify(directoryItems, null, 2);
  }

  _buildStaticInfo({ runtimeBasePath = "" } = {}) {
    const resolvedRuntimeBasePath =
      runtimeBasePath || this._resolveRuntimeBasePath();
    return {
      cwd: process.cwd(),
      userId: this.userId || "",
      basePath: resolvedRuntimeBasePath,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      globalDefaults: {
        workspaceRoot: this.globalConfig?.workspaceRoot || "",
      },
    };
  }

  _buildDynamicInfo({ dialogProcessId = "", sessionTree = {} } = {}) {
    return {
      sessionId: this.sessionId || "",
      caller: this.caller || "user",
      dialogProcessId: String(dialogProcessId || ""),
      sessionTree,
      now: this._now(),
      config: {
        allowUserInteraction: this._isUserInteractionAllowed(),
      },
    };
  }

  _composeSystemInfoSections({
    systemPrompt,
    staticInfo,
    dynamicInfo,
    longMemory = null,
    workspaceDirectories,
    modelSection,
    skills,
    services,
    mcpServers,
    attachments,
  }) {
    return [
      systemPrompt,
      toSystemSection("系统运行环境", JSON.stringify(staticInfo, null, 2)),
      toSystemSection("当前会话动态信息", JSON.stringify(dynamicInfo, null, 2)),
      toSystemSection(
        "工作区目录信息",
        this._buildWorkspaceDirectorySection(workspaceDirectories),
      ),
      ...(hasLongMemoryValue(longMemory)
        ? [
            toSystemSection(
              "相关长期记忆",
              typeof longMemory === "string"
                ? longMemory
                : JSON.stringify(longMemory, null, 2),
            ),
          ]
        : []),
      toSystemSection(
        "可用模型与当前模型",
        JSON.stringify(modelSection, null, 2),
      ),
      toSystemSection("技能清单（一级）", JSON.stringify(skills, null, 2)),
      toSystemSection(
        "可用外部服务端点（serviceName + endpointName + description）",
        JSON.stringify(services, null, 2),
      ),
      toSystemSection(
        "可用 MCP Servers（name + type + description）",
        JSON.stringify(mcpServers, null, 2),
      ),
      toSystemSection(
        "当前附件保存路径",
        attachments?.length
          ? JSON.stringify(
              attachments.map((attachmentItem) =>
                typeof attachmentItem === "string"
                  ? attachmentItem
                  : attachmentItem?.path || attachmentItem,
              ),
              null,
              2,
            )
          : "(无)",
      ),
    ];
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

  async _buildContextData() {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    const [systemPrompt, skills, attachments, workspaceDirectories] =
      await Promise.all([
        this.getSystemPrompt(),
        this._resolveSkills(),
        this._resolveAttachments(),
        this._resolveWorkspaceDirectories(runtimeBasePath),
      ]);
    const services = this._resolveServices();
    const mcpServers = this._resolveAvailableMcpServers();
    const modelSection = this._resolveModelSection();
    return {
      runtimeBasePath,
      systemPrompt,
      skills,
      services,
      mcpServers,
      attachments,
      modelSection,
      workspaceDirectories,
    };
  }

  async _buildSystemContext({ dialogProcessId = "", longMemory = null } = {}) {
    const contextData = await this._buildContextData();
    const sessionTree = await this._resolveSessionTree({
      runtimeBasePath: contextData.runtimeBasePath,
    });
    const systemContext = this._composeSystemInfoSections({
      systemPrompt: contextData.systemPrompt,
      staticInfo: this._buildStaticInfo({
        runtimeBasePath: contextData.runtimeBasePath,
      }),
      dynamicInfo: this._buildDynamicInfo({ dialogProcessId, sessionTree }),
      longMemory,
      workspaceDirectories: contextData.workspaceDirectories,
      modelSection: contextData.modelSection,
      skills: contextData.skills,
      services: contextData.services,
      mcpServers: contextData.mcpServers,
      attachments: contextData.attachments,
    });
    return {
      systemContext,
      runtimeBasePath: contextData.runtimeBasePath,
    };
  }

  async buildInitialContext({ dialogProcessId = "" } = {}) {
    const { systemContext, runtimeBasePath } = await this._buildSystemContext({
      dialogProcessId,
    });
    return this._buildAgentContext(systemContext, [], {
      runtimeBasePath,
      dialogProcessId,
    });
  }

  async buildContinueContext({ dialogProcessId = "" } = {}) {
    const resolvedSessionId = this.sessionId || "";
    const sessionRecords = await this._resolveSessionRecords({
      sessionId: resolvedSessionId,
    });
    const longMemory = await this._resolveLongMemory();
    const { systemContext, runtimeBasePath } = await this._buildSystemContext({
      dialogProcessId,
      longMemory,
    });
    const conversationMessages = this._toConversationMessages(sessionRecords);
    return this._buildAgentContext(systemContext, conversationMessages, {
      runtimeBasePath,
      dialogProcessId,
    });
  }
}
