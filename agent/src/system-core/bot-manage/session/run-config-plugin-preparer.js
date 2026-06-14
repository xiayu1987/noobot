/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAgentHookManager } from "../../hook/index.js";
import { createBotHookManager } from "../hook/index.js";
import { mergeConfig } from "../../config/index.js";
import { resolvePluginRegisterByCapability } from "../../plugin/plugin-loader.js";
import { PLUGIN_CAPABILITY } from "../../plugin/capabilities.js";
import {
  createPluginSelectorSet,
  PLUGIN_REGISTRATION_FLAG,
  PLUGIN_RUNTIME_PROPERTY,
  PLUGIN_SLOT_KEY,
} from "../../plugin/plugin-constants.js";
import { createAgentCapabilityModelInvoker } from "../../agent/core/capability-mini-runner/index.js";
import {
  createPluginPolicyApi,
  hasToolPolicyPatchContent,
  mergeToolPolicyPatch,
} from "./plugin-policy-api.js";
import {
  resolvePluginOptionsFromConfig,
  selectHookManager,
} from "./session-execution-engine-utils.js";

export class RunConfigPluginPreparer {
  constructor({
    globalConfig = {},
    workspaceService = null,
    loadedDynamicPlugins = null,
    pluginRuntime = {},
    normalizeStringArray = null,
    mergePluginOptions = null,
    createPluginResolveModelMessages = null,
    createPluginResolveMessageBlock = null,
    createPluginMarkMessagesSummarized = null,
    createDetachedSubSessionRunner = null,
    createBotSubSessionRunner = null,
    createGeneratedArtifactPersister = null,
    createBotPluginScopedJsonWriter = null,
    createScopedJsonWriter = null,
    createBotPluginScopedEventLogger = null,
    createScopedEventLogger = null,
  } = {}) {
    this.globalConfig = globalConfig;
    this.workspaceService = workspaceService;
    this.loadedDynamicPlugins = loadedDynamicPlugins;
    this.pluginRuntime = pluginRuntime && typeof pluginRuntime === "object" ? pluginRuntime : {};
    this.normalizeStringArray =
      typeof normalizeStringArray === "function" ? normalizeStringArray : (input) => input;
    this.mergeAgentPluginOptions =
      typeof mergePluginOptions === "function"
        ? mergePluginOptions
        : (...items) => Object.assign({}, ...items.filter((item) => item && typeof item === "object"));
    this.createAgentPluginResolveModelMessages = createPluginResolveModelMessages;
    this.createAgentPluginResolveMessageBlock = createPluginResolveMessageBlock;
    this.createAgentPluginMarkMessagesSummarized = createPluginMarkMessagesSummarized;
    this.createBotSubSessionRunner =
      createDetachedSubSessionRunner || createBotSubSessionRunner;
    this.createGeneratedArtifactPersister = createGeneratedArtifactPersister;
    this.createBotPluginScopedJsonWriter =
      createBotPluginScopedJsonWriter || createScopedJsonWriter;
    this.createBotPluginScopedEventLogger =
      createBotPluginScopedEventLogger || createScopedEventLogger;
  }

  prepareRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const preparedAgentPluginConfig = this.prepareAgentPluginRunConfig({
      userId,
      runConfig,
      userConfig,
    });
    const preparedBotHookConfig = this.prepareBotHookRunConfig({
      runConfig: preparedAgentPluginConfig,
    });
    return this.prepareBotPluginRunConfig({
      userId,
      runConfig: preparedBotHookConfig,
      userConfig,
    });
  }

  resolveAgentPluginOptions({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const agentPluginSelectors = resolveAgentPluginSelectors(this.pluginRuntime);
    const effectiveConfig = mergeConfig(
      this.globalConfig || {},
      userConfig && typeof userConfig === "object" ? userConfig : {},
    );
    const effectiveAgentPlugin = resolvePluginOptionsFromConfig(
      effectiveConfig,
      agentPluginSelectors,
    );
    if (effectiveAgentPlugin?.enabled === false) return { enabled: false, mode: "off" };
    const runAgentPlugin = resolvePluginOptionsFromConfig(
      runConfig,
      agentPluginSelectors,
    );
    if (runAgentPlugin?.enabled === false) return { enabled: false, mode: "off" };
    const selectedPlugins = Array.isArray(runConfig?.selectedPlugins)
      ? runConfig.selectedPlugins
      : [];
    const agentPluginSelected = selectedPlugins.some((item) =>
      agentPluginSelectors.has(String(item || "").trim()),
    );
    const options = this.mergeAgentPluginOptions(
      effectiveAgentPlugin,
      runAgentPlugin,
    );
    const normalizedMode = String(agentPluginSelected ? "on" : options?.mode ?? "off")
      .trim()
      .toLowerCase();
    const resolvedMode = normalizedMode === "on" ? "on" : "off";
    if (resolvedMode !== "on") return { enabled: false, mode: "off" };
    const basePath =
      typeof options.basePath === "string" && options.basePath.trim()
        ? options.basePath.trim()
        : this.workspaceService && userId
          ? this.workspaceService.getWorkspacePath(userId)
          : "";
    const next = { ...options, enabled: true, mode: "on", basePath };
    next.resolveModelMessages = this.createAgentPluginResolveModelMessages({
      agentPluginOptions: next,
    });
    next.resolveMessageBlock = this.createAgentPluginResolveMessageBlock({
      agentPluginOptions: next,
    });
    next.markMessagesSummarized = this.createAgentPluginMarkMessagesSummarized();
    next.miniRunnerMaxTurns =
      Number.isFinite(Number(next?.miniRunnerMaxTurns)) && Number(next.miniRunnerMaxTurns) > 0
        ? Math.min(Number(next.miniRunnerMaxTurns), 5)
        : 5;
    if (!String(next?.planningGuidanceMode || "").trim()) {
      next.planningGuidanceMode = "separate_model";
    }
    if (String(next?.planningGuidanceMode || "").trim().toLowerCase() === "separate_model") {
      const timeoutMs = Number(next?.timeoutMs);
      // Separate-model planning performs external model calls; 1s timeout is too
      // aggressive and causes repeated scheduling across turns.
      if (!Number.isFinite(timeoutMs) || timeoutMs < 180_000) {
        next.timeoutMs = 180_000;
      }
    }
    if (
      String(next?.planningGuidanceMode || "").trim().toLowerCase() === "separate_model" &&
      typeof next?.capabilityModelInvoker !== "function"
    ) {
      next.capabilityModelInvoker = createAgentCapabilityModelInvoker({
        maxTurns: next?.miniRunnerMaxTurns,
        enableToolBinding: false,
      });
    }
    return next;
  }


  prepareAgentPluginRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const agentPluginKey = resolveAgentPluginKey(this.pluginRuntime);
    const agentPluginOptions = this.resolveAgentPluginOptions({
      userId,
      runConfig,
      userConfig,
    });
    if (!agentPluginOptions.enabled) return runConfig;
    return this.prepareRegisteredPluginRunConfig({
      runConfig,
      options: agentPluginOptions,
      pluginName: agentPluginKey,
      capability: PLUGIN_CAPABILITY.AGENT_REGISTER,
      managerKey: "hookManager",
      hooksKey: "hooks",
      runtimeKey: PLUGIN_SLOT_KEY.AGENT,
      registrationFlag: PLUGIN_REGISTRATION_FLAG.AGENT,
      createManager: createAgentHookManager,
    });
  }


  resolveBotPluginOptions({ runConfig = {}, userConfig = {} } = {}) {
    const botPluginSelectors = resolveBotPluginSelectors(this.pluginRuntime);
    const effectiveConfig = mergeConfig(
      this.globalConfig || {},
      userConfig && typeof userConfig === "object" ? userConfig : {},
    );
    const effectiveBotPlugin = resolvePluginOptionsFromConfig(
      effectiveConfig,
      botPluginSelectors,
    );
    if (effectiveBotPlugin?.enabled === false) return { enabled: false, mode: "off" };
    const runBotPlugin = resolvePluginOptionsFromConfig(
      runConfig,
      botPluginSelectors,
    );
    if (runBotPlugin?.enabled === false) return { enabled: false, mode: "off" };
    const selectedPlugins = Array.isArray(runConfig?.selectedPlugins)
      ? runConfig.selectedPlugins
      : [];
    const botPluginSelected = selectedPlugins.some((item) =>
      botPluginSelectors.has(String(item || "").trim()),
    );
    const normalizedEffectiveMode = String(effectiveBotPlugin?.mode ?? "off")
      .trim()
      .toLowerCase();
    const normalizedRunMode = String(runBotPlugin?.mode ?? "")
      .trim()
      .toLowerCase();
    // keep user/global on as baseline; runConfig should primarily elevate the bot plugin,
    // unless it explicitly disables plugin via enabled=false (used by node sub-session strategy)
    const resolvedMode =
      botPluginSelected || normalizedRunMode === "on" || normalizedEffectiveMode === "on"
        ? "on"
        : "off";
    if (resolvedMode !== "on") return { enabled: false, mode: "off" };
    const options = {
      ...(effectiveBotPlugin && typeof effectiveBotPlugin === "object" ? effectiveBotPlugin : {}),
      ...(runBotPlugin && typeof runBotPlugin === "object" ? runBotPlugin : {}),
    };
    const next = { ...options, enabled: true, mode: "on" };
    next.resolveModelMessages = this.createAgentPluginResolveModelMessages({
      botPluginOptions: next,
    });
    if (!String(next?.semanticMode || "").trim()) {
      next.semanticMode = "separate_model";
    }
    if (
      String(next?.semanticMode || "").trim().toLowerCase() === "separate_model" &&
      typeof next?.capabilityModelInvoker !== "function"
    ) {
      next.capabilityModelInvoker = createAgentCapabilityModelInvoker({
        maxTurns: next?.miniRunnerMaxTurns,
        enableToolBinding: false,
        headerNamespace: "plugin",
        flowPrefix: "botPlugin",
        fallbackGlobalConfig: this.globalConfig || {},
        fallbackUserConfig: userConfig && typeof userConfig === "object" ? userConfig : {},
      });
    }
    if (typeof next?.subSessionRunner !== "function") {
      next.subSessionRunner = this.createBotSubSessionRunner();
    }
    if (typeof next?.generatedArtifactPersister !== "function") {
      next.generatedArtifactPersister = this.createGeneratedArtifactPersister();
    }
    if (typeof next?.botPluginDialogPersister !== "function") {
      next.botPluginDialogPersister = this.createBotPluginScopedJsonWriter();
    }
    if (typeof next?.botPluginEventLogger !== "function") {
      next.botPluginEventLogger = this.createBotPluginScopedEventLogger();
    }
    return next;
  }


  prepareBotPluginRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const botPluginKey = resolveBotPluginKey(this.pluginRuntime);
    const botPluginOptions = this.resolveBotPluginOptions({
      userId,
      runConfig,
      userConfig,
    });
    if (!botPluginOptions.enabled) return runConfig;
    return this.prepareRegisteredPluginRunConfig({
      runConfig,
      options: botPluginOptions,
      pluginName: botPluginKey,
      capability: PLUGIN_CAPABILITY.BOT_REGISTER,
      managerKey: "botHookManager",
      hooksKey: "botHooks",
      runtimeKey: PLUGIN_SLOT_KEY.BOT,
      registrationFlag: PLUGIN_REGISTRATION_FLAG.BOT,
      createManager: createBotHookManager,
    });
  }


  prepareBotHookRunConfig({ runConfig = {} } = {}) {
    const botHookManager = selectHookManager({
      runConfig,
      managerKey: "botHookManager",
      hooksKey: "botHooks",
      createManager: createBotHookManager,
    });
    return {
      ...runConfig,
      botHookManager,
    };
  }

  prepareRegisteredPluginRunConfig({
    runConfig = {},
    options = {},
    pluginName = "",
    capability = "",
    managerKey = "",
    hooksKey = "",
    runtimeKey = "",
    registrationFlag = "",
    createManager = null,
  } = {}) {
    const manager = selectHookManager({
      runConfig,
      managerKey,
      hooksKey,
      createManager,
    });
    const pluginApi = this.buildPluginRegisterApi({
      manager,
      pluginName,
      options,
      runConfig,
    });
    const registrationFlags = normalizeRegistrationFlags([registrationFlag]);
    const alreadyRegistered = registrationFlags.some((flag) => manager?.[flag] === true);
    if (!alreadyRegistered) {
      const registerPlugin = resolvePluginRegisterByCapability(
        this.loadedDynamicPlugins,
        capability,
      );
      if (typeof registerPlugin === "function") {
        registerPlugin(pluginApi, options);
        defineRegistrationFlags(manager, registrationFlags);
      }
    } else if (typeof pluginApi?.policy?.appendDenyToolNames === "function") {
      // Keep per-run policy patch behavior even when hook registration is reused.
      pluginApi.policy.appendDenyToolNames(options?.denyToolNames || []);
    }
    const existingRuntimeMeta =
      manager?.runtime && typeof manager.runtime === "object" ? manager.runtime : {};
    manager.runtime = {
      ...existingRuntimeMeta,
      [runtimeKey]:
        options && typeof options === "object"
          ? options
          : existingRuntimeMeta[runtimeKey],
    };
    const pluginToolPolicyPatch = pluginApi?.policy?.getToolPolicyPatch?.() || {};
    const shouldAttachToolPolicy =
      (runConfig?.toolPolicy && typeof runConfig.toolPolicy === "object") ||
      hasToolPolicyPatchContent({
        toolPolicyPatch: pluginToolPolicyPatch,
        normalizeStringArray: (input) => this.normalizeStringArray(input),
      });
    return {
      ...runConfig,
      [managerKey]: manager,
      ...(shouldAttachToolPolicy
        ? {
            toolPolicy: mergeToolPolicyPatch({
              baseToolPolicy: runConfig?.toolPolicy,
              toolPolicyPatch: pluginToolPolicyPatch,
              normalizeStringArray: (input) => this.normalizeStringArray(input),
            }),
          }
        : {}),
      plugins: {
        ...(runConfig?.plugins || {}),
        [runtimeKey]: options,
        [pluginName]: options,
      },
    };
  }

  buildPluginRegisterApi({ manager = null, pluginName = "", options = {}, runConfig = {} } = {}) {
    const hookManager = manager && typeof manager === "object" ? manager : null;
    const safePluginName = String(pluginName || "").trim();
    const safeOptions = options && typeof options === "object" ? options : {};
    const policy = createPluginPolicyApi({
      baseToolPolicy: runConfig?.toolPolicy,
      normalizeStringArray: (input) => this.normalizeStringArray(input),
    });
    return {
      hookManager,
      hooks: hookManager,
      botHookManager: hookManager,
      botHooks: hookManager,
      policy,
      runtime: {
        plugin: safePluginName,
        options: safeOptions,
      },
      runConfig: {
        plugins: {
          [safePluginName]: safeOptions,
        },
      },
    };
  }
}

function resolveAgentPluginKey(pluginRuntime = {}) {
  return String(
    pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_KEY] || PLUGIN_SLOT_KEY.AGENT,
  ).trim() || PLUGIN_SLOT_KEY.AGENT;
}

function normalizeRegistrationFlags(flags = []) {
  return (Array.isArray(flags) ? flags : [])
    .map((flag) => String(flag || "").trim())
    .filter(Boolean);
}

function defineRegistrationFlags(manager = null, flags = []) {
  if (!manager || typeof manager !== "object") return;
  for (const flag of normalizeRegistrationFlags(flags)) {
    Object.defineProperty(manager, flag, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  }
}


function resolveBotPluginKey(pluginRuntime = {}) {
  return String(
    pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_KEY] || PLUGIN_SLOT_KEY.BOT,
  ).trim() || PLUGIN_SLOT_KEY.BOT;
}

function resolveAgentPluginSelectors(pluginRuntime = {}) {
  return pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.AGENT_PLUGIN_SELECTORS] ||
    createPluginSelectorSet(PLUGIN_SLOT_KEY.AGENT);
}

function resolveBotPluginSelectors(pluginRuntime = {}) {
  return pluginRuntime?.[PLUGIN_RUNTIME_PROPERTY.BOT_PLUGIN_SELECTORS] ||
    createPluginSelectorSet(PLUGIN_SLOT_KEY.BOT);
}
