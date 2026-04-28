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
import { getConnectorHistoryStore } from "../connectors/history-store.js";
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

function normalizeHistoryConnectorItems(items = []) {
  return (Array.isArray(items) ? items : []).map((connectorItem) => ({
    connector_name: String(connectorItem?.connector_name || "").trim(),
    connector_type: String(connectorItem?.connector_type || "").trim(),
    connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connection_meta:
      connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
        ? connectorItem.connection_meta
        : {},
    status: String(connectorItem?.status || "disconnected").trim() || "disconnected",
    status_code: Number(connectorItem?.status_code ?? 410),
    status_message:
      String(connectorItem?.status_message || "").trim() || "未连接（历史记录）",
    checked_at:
      String(connectorItem?.checked_at || connectorItem?.last_connected_at || "").trim(),
    last_connected_at: String(connectorItem?.last_connected_at || "").trim(),
    connect_count: Number(connectorItem?.connect_count || 0),
    connection_defaults:
      connectorItem?.connection_defaults &&
      typeof connectorItem.connection_defaults === "object"
        ? connectorItem.connection_defaults
        : {},
  }));
}

function mergeRuntimeAndHistoryConnectorGroup({
  runtimeConnectors = [],
  historyConnectors = [],
} = {}) {
  const runtimeList = Array.isArray(runtimeConnectors) ? runtimeConnectors : [];
  const historyList = normalizeHistoryConnectorItems(historyConnectors);
  const mergedByName = new Map();
  for (const historyItem of historyList) {
    const connectorName = String(historyItem?.connector_name || "").trim();
    if (!connectorName) continue;
    mergedByName.set(connectorName, historyItem);
  }
  for (const runtimeItem of runtimeList) {
    const connectorName = String(runtimeItem?.connector_name || "").trim();
    if (!connectorName) continue;
    const previousItem = mergedByName.get(connectorName) || {};
    mergedByName.set(connectorName, {
      ...previousItem,
      ...runtimeItem,
      status: String(runtimeItem?.status || "connected").trim() || "connected",
      status_code: Number(runtimeItem?.status_code ?? 0),
      status_message: String(runtimeItem?.status_message || "ok").trim(),
      checked_at:
        String(runtimeItem?.checked_at || runtimeItem?.connected_at || "").trim() ||
        String(previousItem?.checked_at || "").trim(),
      last_connected_at:
        String(runtimeItem?.connected_at || "").trim() ||
        String(previousItem?.last_connected_at || "").trim(),
    });
  }
  return Array.from(mergedByName.values()).sort((leftConnector, rightConnector) => {
    const leftTime = new Date(
      leftConnector?.last_connected_at || leftConnector?.checked_at || 0,
    ).getTime();
    const rightTime = new Date(
      rightConnector?.last_connected_at || rightConnector?.checked_at || 0,
    ).getTime();
    return rightTime - leftTime;
  });
}

function resolveConnectorSubType(connectorItem = {}) {
  const connectionMeta =
    connectorItem?.connection_meta && typeof connectorItem.connection_meta === "object"
      ? connectorItem.connection_meta
      : {};
  const subTypeCandidates = [
    connectionMeta?.databaseType,
    connectionMeta?.database_type,
    connectionMeta?.terminalType,
    connectionMeta?.terminal_type,
    connectionMeta?.emailType,
    connectionMeta?.email_type,
    connectionMeta?.subType,
    connectionMeta?.sub_type,
  ];
  for (const subTypeCandidate of subTypeCandidates) {
    const normalizedSubType = String(subTypeCandidate || "").trim();
    if (normalizedSubType) return normalizedSubType;
  }
  const connectorType = String(connectorItem?.connector_type || "").trim();
  if (connectorType === "email") return "smtp_imap";
  return "";
}

function toCompactConnectorInfo(connectorItem = {}) {
  return {
    connector_name: String(connectorItem?.connector_name || "").trim(),
    connector_type: String(connectorItem?.connector_type || "").trim(),
    connector_sub_type: resolveConnectorSubType(connectorItem),
  };
}

function buildSelectedCompactConnector({
  connectorType = "",
  connectorName = "",
  sourceList = [],
} = {}) {
  const normalizedConnectorType = String(connectorType || "").trim();
  const normalizedConnectorName = String(connectorName || "").trim();
  if (!normalizedConnectorName) return null;
  const hitConnector =
    (Array.isArray(sourceList) ? sourceList : []).find(
      (connectorItem) =>
        String(connectorItem?.connector_name || "").trim() ===
        normalizedConnectorName,
    ) || null;
  return {
    connector_name: normalizedConnectorName,
    connector_type: normalizedConnectorType,
    connector_sub_type: String(hitConnector?.connector_sub_type || "").trim(),
  };
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
  }) {
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

  async _resolveSessionTreeWithRootSessionId({ runtimeBasePath = "" } = {}) {
    const sessionTree = await this._resolveSessionTree({ runtimeBasePath });
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
    return {
      sessionTree,
      rootSessionId: String(rootSessionId || this.sessionId || "").trim(),
    };
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

  _buildRuntimeContext({
    dialogProcessId,
    sessionTree,
    rootSessionId = "",
    attachmentMetas = [],
  }) {
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
        selectedConnectors: {
          database: String(this.runConfig?.selectedConnectors?.database || "").trim(),
          terminal: String(this.runConfig?.selectedConnectors?.terminal || "").trim(),
          email: String(this.runConfig?.selectedConnectors?.email || "").trim(),
        },
        ...(resolvedMaxToolLoopTurns > 0
          ? { maxToolLoopTurns: resolvedMaxToolLoopTurns }
          : {}),
      },
    };

    return {
      userId: this.userId || "",
      globalConfig: this.globalConfig,
      userConfig: this.userConfig,
      eventListener: this.eventListener,
      sessionManager: this.sessionManager,
      attachmentService: this.attachmentService,
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
      attachmentMetas: Array.isArray(attachmentMetas) ? attachmentMetas : [],
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
    const connectorHistoryStore = getConnectorHistoryStore();
    sharedTools.connectorChannelStore = connectorChannelStore;
    sharedTools.connectorHistoryStore = connectorHistoryStore;
    runtimeContext.connectorChannels = rootSessionId
      ? connectorChannelStore.getSessionConnectors(rootSessionId)
      : { databases: [], terminals: [], emails: [] };

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
    const resolvedSessionTree = isPlainObject(sessionTree)
      ? sessionTree
      : await this._resolveSessionTree({
          runtimeBasePath: resolvedRuntimeBasePath,
        });
    const resolvedRootSessionId = String(rootSessionId || "").trim()
      ? String(rootSessionId || "").trim()
      : await (async () => {
          if (
            this.sessionManager?.getRootSessionId &&
            this.userId &&
            this.sessionId
          ) {
            const resolvedId = await this.sessionManager.getRootSessionId({
              userId: this.userId,
              sessionId: this.sessionId,
              sessionTree: resolvedSessionTree,
            });
            return String(resolvedId || this.sessionId || "").trim();
          }
          return String(this.sessionId || "").trim();
        })();
    const staticAgentContext = await this._buildStaticAgentContext({
      runtimeBasePath: resolvedRuntimeBasePath,
    });
    const agentContext = {
      ...staticAgentContext,
      systemMessages,
      conversationMessages,
      runtime: this._buildRuntimeContext({
        dialogProcessId,
        sessionTree: resolvedSessionTree,
        rootSessionId: resolvedRootSessionId,
        attachmentMetas,
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
    const effectiveConfig = this._getEffectiveConfig();
    const attachmentPolicy =
      effectiveConfig?.attachments && typeof effectiveConfig.attachments === "object"
        ? effectiveConfig.attachments
        : {};
    const hasIngestedRecords = (this.attachmentMetas || []).some(
      (attachmentItem) =>
        String(attachmentItem?.attachmentId || "").trim() &&
        String(attachmentItem?.path || "").trim(),
    );
    if (hasIngestedRecords) {
      return (this.attachmentMetas || []).map((attachmentItem) => ({
        attachmentId: String(attachmentItem?.attachmentId || ""),
        sessionId: String(attachmentItem?.sessionId || this.sessionId || ""),
        attachmentSource: String(
          attachmentItem?.attachmentSource || "user",
        ).trim(),
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
      sessionId: this.sessionId || "",
      attachmentSource: "user",
      attachments: this.attachmentMetas,
      attachmentPolicy,
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
      used_for_conversation:
        modelSpec?.used_for_conversation === undefined
          ? true
          : modelSpec?.used_for_conversation === true,
      multimodal_generation: this._normalizeModelMultimodalInfo(modelSpec),
    };
  }

  _normalizeModelMultimodalInfo(modelSpec = {}) {
    const multimodalGeneration = isPlainObject(modelSpec?.multimodal_generation)
      ? modelSpec.multimodal_generation
      : {};
    const supportGeneration = isPlainObject(multimodalGeneration?.support_generation)
      ? multimodalGeneration.support_generation
      : {};
    const supportScope = Array.isArray(supportGeneration?.support_scope)
      ? supportGeneration.support_scope
          .map((scopeItem) => String(scopeItem || "").trim())
          .filter(Boolean)
      : [];
    return {
      support_understanding: multimodalGeneration?.support_understanding === true,
      support_generation: {
        enabled: supportGeneration?.enabled === true,
        support_scope: supportScope,
      },
    };
  }

  _resolveAvailableModels() {
    const effectiveConfig = this._getEffectiveConfig();
    const providers = effectiveConfig?.providers || {};
    return Object.entries(providers)
      .filter(([, providerConfig]) => providerConfig?.enabled !== false)
      .map(([alias, providerConfig]) => ({
        alias,
        name: providerConfig?.model || "",
        description: providerConfig?.description || "",
        used_for_conversation:
          providerConfig?.used_for_conversation === undefined
            ? true
            : providerConfig?.used_for_conversation === true,
        multimodal_generation: this._normalizeModelMultimodalInfo(providerConfig),
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
      attachmentMetas: Array.isArray(item.attachmentMetas)
        ? item.attachmentMetas
        : Array.isArray(item.attachments)
          ? item.attachments
          : [],
    }));
  }

  _buildWorkspaceDirectorySection(workspaceDirectories = []) {
    const descriptions = {
      runtime: "运行时数据根目录",
      "runtime/attach": "附件根目录（按 sessionId 与来源分目录存储）",
      "runtime/attach/scoped": "附件分组目录：scoped/<sessionId>/<source>/attachments.json",
      "runtime/connectors": "连接器运行与历史信息（如 connector-history.json）",
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
    const selectedConnectors =
      this.runConfig?.selectedConnectors &&
      typeof this.runConfig.selectedConnectors === "object"
        ? this.runConfig.selectedConnectors
        : {};
    return {
      sessionId: this.sessionId || "",
      caller: this.caller || "user",
      dialogProcessId: String(dialogProcessId || ""),
      sessionTree,
      now: this._now(),
      config: {
        allowUserInteraction: this._isUserInteractionAllowed(),
        selectedConnectors: {
          database: String(selectedConnectors?.database || "").trim(),
          terminal: String(selectedConnectors?.terminal || "").trim(),
          email: String(selectedConnectors?.email || "").trim(),
        },
      },
    };
  }

  async _resolveConnectorStatusSection({
    rootSessionId = "",
    connectorChannelStore = null,
    connectorHistoryStore = null,
    selectedConnectors = {},
  } = {}) {
    const normalizedRootSessionId = String(rootSessionId || "").trim();
    const normalizedSelectedConnectors = {
      database: String(selectedConnectors?.database || "").trim(),
      terminal: String(selectedConnectors?.terminal || "").trim(),
      email: String(selectedConnectors?.email || "").trim(),
    };
    if (
      !normalizedRootSessionId ||
      !connectorChannelStore ||
      typeof connectorChannelStore.inspectSessionConnectors !== "function"
    ) {
      return {
        root_session_id: normalizedRootSessionId,
        connectors: { databases: [], terminals: [], emails: [] },
        current_connectors: {
          database: buildSelectedCompactConnector({
            connectorType: "database",
            connectorName: normalizedSelectedConnectors.database,
          }),
          terminal: buildSelectedCompactConnector({
            connectorType: "terminal",
            connectorName: normalizedSelectedConnectors.terminal,
          }),
          email: buildSelectedCompactConnector({
            connectorType: "email",
            connectorName: normalizedSelectedConnectors.email,
          }),
        },
      };
    }
    const inspectedConnectors = await connectorChannelStore.inspectSessionConnectors({
      sessionId: normalizedRootSessionId,
      timeoutMs: 6000,
    });
    const historyConnectors =
      connectorHistoryStore &&
      typeof connectorHistoryStore.listSessionConnectors === "function"
        ? await connectorHistoryStore.listSessionConnectors({
            userId: this.userId,
            sessionId: normalizedRootSessionId,
          })
        : { database: [], terminal: [], email: [] };
    const mergedDatabases = mergeRuntimeAndHistoryConnectorGroup({
      runtimeConnectors: inspectedConnectors?.connectors?.databases || [],
      historyConnectors: historyConnectors?.database || [],
    });
    const mergedTerminals = mergeRuntimeAndHistoryConnectorGroup({
      runtimeConnectors: inspectedConnectors?.connectors?.terminals || [],
      historyConnectors: historyConnectors?.terminal || [],
    });
    const mergedEmails = mergeRuntimeAndHistoryConnectorGroup({
      runtimeConnectors: inspectedConnectors?.connectors?.emails || [],
      historyConnectors: historyConnectors?.email || [],
    });
    const compactDatabases = mergedDatabases.map((connectorItem) =>
      toCompactConnectorInfo(connectorItem),
    );
    const compactTerminals = mergedTerminals.map((connectorItem) =>
      toCompactConnectorInfo(connectorItem),
    );
    const compactEmails = mergedEmails.map((connectorItem) =>
      toCompactConnectorInfo(connectorItem),
    );
    return {
      root_session_id: normalizedRootSessionId,
      connectors: {
        databases: compactDatabases,
        terminals: compactTerminals,
        emails: compactEmails,
      },
      current_connectors: {
        database: buildSelectedCompactConnector({
          connectorType: "database",
          connectorName: normalizedSelectedConnectors.database,
          sourceList: compactDatabases,
        }),
        terminal: buildSelectedCompactConnector({
          connectorType: "terminal",
          connectorName: normalizedSelectedConnectors.terminal,
          sourceList: compactTerminals,
        }),
        email: buildSelectedCompactConnector({
          connectorType: "email",
          connectorName: normalizedSelectedConnectors.email,
          sourceList: compactEmails,
        }),
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
    attachmentMetas,
    connectorStatusSection,
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
        "当前连接器信息",
        JSON.stringify(connectorStatusSection || {}, null, 2),
      ),
      toSystemSection(
        "当前附件元信息",
        attachmentMetas?.length
          ? JSON.stringify(
              attachmentMetas.map((attachmentItem) =>
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
    const [systemPrompt, skills, attachmentMetas, workspaceDirectories] =
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
      attachmentMetas,
      modelSection,
      workspaceDirectories,
    };
  }

  async _buildSystemContext({ dialogProcessId = "", longMemory = null } = {}) {
    const contextData = await this._buildContextData();
    const {
      sessionTree,
      rootSessionId,
    } = await this._resolveSessionTreeWithRootSessionId({
      runtimeBasePath: contextData.runtimeBasePath,
    });
    const connectorStatusSection = await this._resolveConnectorStatusSection({
      rootSessionId,
      connectorChannelStore: getConnectorChannelStore(),
      connectorHistoryStore: getConnectorHistoryStore(),
      selectedConnectors:
        this.runConfig?.selectedConnectors &&
        typeof this.runConfig.selectedConnectors === "object"
          ? this.runConfig.selectedConnectors
          : {},
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
      attachmentMetas: contextData.attachmentMetas,
      connectorStatusSection,
    });
    return {
      systemContext,
      runtimeBasePath: contextData.runtimeBasePath,
      sessionTree,
      rootSessionId,
      attachmentMetas: contextData.attachmentMetas,
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
    const resolvedSessionId = this.sessionId || "";
    const sessionRecords = await this._resolveSessionRecords({
      sessionId: resolvedSessionId,
    });
    const longMemory = await this._resolveLongMemory();
    const {
      systemContext,
      runtimeBasePath,
      sessionTree,
      rootSessionId,
      attachmentMetas,
    } = await this._buildSystemContext({ dialogProcessId, longMemory });
    const conversationMessages = this._toConversationMessages(sessionRecords);
    return this._buildAgentContext(systemContext, conversationMessages, {
      runtimeBasePath,
      dialogProcessId,
      sessionTree,
      rootSessionId,
      attachmentMetas,
    });
  }
}
