/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { mergeConfig } from "../config/index.js";
import { resolveDefaultModelSpec } from "../model/index.js";
import { buildTools } from "../tools/index.js";

function toSystemSection(title, content) {
  return `# ${title}\n${content}`;
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
    this._effectiveConfigCache = null;
  }

  getSystemPrompt() {
    return readFileSync("./system-core/system-prompt/base.md", "utf8");
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

  _buildSystemRuntime({ runtimeBasePath = "" } = {}) {
    const resolvedRuntimeBasePath =
      runtimeBasePath || this._resolveRuntimeBasePath();
    return {
      cwd: process.cwd(),
      userId: this.userId || "",
      basePath: resolvedRuntimeBasePath,
      sessionId: this.sessionId || "",
      caller: this.caller || "user",
      parentSessionId: this.parentSessionId || "",
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      now: this._now(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      globalDefaults: {
        workspaceRoot: this.globalConfig?.workspaceRoot || "",
      },
    };
  }

  _buildStaticAgentContext({ runtimeBasePath = "" } = {}) {
    const staticInfo = this._buildSystemRuntime({ runtimeBasePath });
    return {
      cwd: staticInfo.cwd || process.cwd(),
      userId: staticInfo.userId || "",
      basePath: staticInfo.basePath || runtimeBasePath || "",
      platform: staticInfo.platform || process.platform,
      arch: staticInfo.arch || process.arch,
      nodeVersion: staticInfo.nodeVersion || process.version,
      timezone:
        staticInfo.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      globalDefaults: staticInfo.globalDefaults || {
        workspaceRoot: this.globalConfig?.workspaceRoot || "",
      },
      workspaceDirectories: this._resolveWorkspaceDirectories(
        staticInfo.basePath || runtimeBasePath || "",
      ),
    };
  }

  _resolveSessionTree() {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    if (!runtimeBasePath) {
      return { roots: [], nodes: {}, updatedAt: this._now() };
    }
    if (!this.sessionManager?.getSessionTree) {
      return { roots: [], nodes: {}, updatedAt: this._now() };
    }
    return this.sessionManager.getSessionTree({ userId: this.userId });
  }

  _resolveWorkspaceDirectories(runtimeBasePath = "") {
    const basePath = String(runtimeBasePath || "").trim();
    if (!basePath || !existsSync(basePath)) return [];

    const directories = new Set();
    let level1Entries = [];
    try {
      level1Entries = readdirSync(basePath, { withFileTypes: true });
    } catch {
      return [];
    }

    for (const entry of level1Entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      directories.add(entry.name);
    }

    const runtimeDirPath = path.join(basePath, "runtime");
    if (existsSync(runtimeDirPath)) {
      let runtimeLevel1Entries = [];
      try {
        runtimeLevel1Entries = readdirSync(runtimeDirPath, {
          withFileTypes: true,
        });
      } catch {
        runtimeLevel1Entries = [];
      }
      for (const entry of runtimeLevel1Entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        directories.add(path.posix.join("runtime", entry.name));
      }
    }

    return Array.from(directories).sort((leftDir, rightDir) =>
      leftDir.localeCompare(rightDir),
    );
  }

  _buildRuntimeContext({ runtimeBasePath, dialogProcessId, sessionTree }) {
    const normalizedDialogProcessId = String(dialogProcessId || "");
    const systemRuntime = {
      sessionId: this.sessionId || "",
      caller: this.caller || "user",
      parentSessionId: this.parentSessionId || "",
      dialogProcessId: normalizedDialogProcessId,
      sessionTree,
      now: this._now(),
    };

    return {
      globalConfig: this.globalConfig,
      userConfig: this.userConfig,
      eventListener: this.eventListener,
      sessionManager: this.sessionManager,
      botManager: this.botManager,
      allEnabledProviders: this._resolveAllEnabledProviders(),
      systemRuntime,
    };
  }

  _buildAgentContext(
    systemMessages,
    conversationMessages,
    { runtimeBasePath = "", dialogProcessId = "" } = {},
  ) {
    const resolvedRuntimeBasePath =
      runtimeBasePath || this._resolveRuntimeBasePath();
    const sessionTree = this._resolveSessionTree();
    const staticAgentContext = this._buildStaticAgentContext({
      runtimeBasePath: resolvedRuntimeBasePath,
    });
    const agentContext = {
      ...staticAgentContext,
      systemMessages,
      conversationMessages,
      runtime: this._buildRuntimeContext({
        runtimeBasePath: resolvedRuntimeBasePath,
        dialogProcessId,
        sessionTree,
      }),
    };
    agentContext.tools = buildTools({
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
    return await this.attachmentService.ingest({
      userId: this.userId,
      attachments: this.attachments,
    });
  }

  _resolveSkills() {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    if (!this.skillService || !runtimeBasePath) return [];
    return this.skillService.listSkills({ userId: this.userId });
  }

  _resolveLongMemory() {
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
          "query-string-format": endpointCfg?.["query-string-format"] || "",
          "body-format": endpointCfg?.["body-format"] || "",
        });
      }
    }
    return serviceEndpointList;
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

  _buildCommonSystemMessages({
    systemPrompt,
    systemRuntime,
    workspaceDirectories,
    modelSection,
    skills,
    services,
    attachments,
  }) {
    return [
      systemPrompt,
      toSystemSection("系统运行环境", JSON.stringify(systemRuntime, null, 2)),
      toSystemSection(
        "工作区目录信息",
        this._buildWorkspaceDirectorySection(workspaceDirectories),
      ),
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

  _resolveSessionRecords({ sessionId } = {}) {
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

  async _buildCommonContextData() {
    const runtimeBasePath = this._resolveRuntimeBasePath();
    const systemPrompt = this.getSystemPrompt();
    const skills = this._resolveSkills();
    const services = this._resolveServices();
    const attachments = await this._resolveAttachments();
    const systemRuntime = this._buildSystemRuntime({
      runtimeBasePath,
    });
    const modelSection = this._resolveModelSection();
    const workspaceDirectories =
      this._resolveWorkspaceDirectories(runtimeBasePath);
    return {
      runtimeBasePath,
      systemPrompt,
      skills,
      services,
      attachments,
      systemRuntime,
      modelSection,
      workspaceDirectories,
    };
  }

  _buildSystemMessagesFromCommon(contextData = {}) {
    return this._buildCommonSystemMessages({
      systemPrompt: contextData.systemPrompt,
      systemRuntime: contextData.systemRuntime,
      workspaceDirectories: contextData.workspaceDirectories,
      modelSection: contextData.modelSection,
      skills: contextData.skills,
      services: contextData.services,
      attachments: contextData.attachments,
    });
  }

  async buildInitialContext({ dialogProcessId = "" } = {}) {
    const commonContextData = await this._buildCommonContextData();
    const systemMessages =
      this._buildSystemMessagesFromCommon(commonContextData);
    return this._buildAgentContext(systemMessages, [], {
      runtimeBasePath: commonContextData.runtimeBasePath,
      dialogProcessId,
    });
  }

  async buildContinueContext({ dialogProcessId = "" } = {}) {
    const resolvedSessionId = this.sessionId || "";
    const sessionRecords = this._resolveSessionRecords({
      sessionId: resolvedSessionId,
    });
    const longMemory = this._resolveLongMemory();
    const commonContextData = await this._buildCommonContextData();
    const conversationMessages = this._toConversationMessages(sessionRecords);
    const commonSections =
      this._buildSystemMessagesFromCommon(commonContextData);
    const systemMessages = [
      ...commonSections.slice(0, 3),
      toSystemSection(
        "相关长期记忆",
        JSON.stringify((longMemory || []).slice(-20), null, 2),
      ),
      ...commonSections.slice(3),
    ];
    return this._buildAgentContext(systemMessages, conversationMessages, {
      runtimeBasePath: commonContextData.runtimeBasePath,
      dialogProcessId,
    });
  }
}
