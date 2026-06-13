/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAgentHookManager } from "../../hook/index.js";
import { createBotHookManager } from "../hook/index.js";
import { BUILTIN_THRESHOLDS, mergeConfig } from "../../config/index.js";
import { resolvePluginRegisterByCapability } from "../../plugin/plugin-loader.js";
import { PLUGIN_CAPABILITY } from "../../plugin/capabilities.js";
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

export class RunConfigExtensionPreparer {
  constructor({
    globalConfig = {},
    workspaceService = null,
    loadedDynamicPlugins = null,
    extensionRuntime = {},
    normalizeStringArray = null,
    mergeModelExtensionOptions = null,
    mergeHarnessExtensionOptions = null,
    createExtensionResolveModelMessages = null,
    createHarnessResolveModelMessages = null,
    createExtensionResolveMessageBlock = null,
    createHarnessResolveMessageBlock = null,
    createExtensionMarkMessagesSummarized = null,
    createHarnessMarkMessagesSummarized = null,
    createDetachedSubSessionRunner = null,
    createBotSubSessionRunner = null,
    createGeneratedArtifactPersister = null,
    createScopedJsonWriter = null,
    createWorkflowScopedJsonWriter = null,
    createScopedEventLogger = null,
    createWorkflowScopedEventLogger = null,
  } = {}) {
    this.globalConfig = globalConfig;
    this.workspaceService = workspaceService;
    this.loadedDynamicPlugins = loadedDynamicPlugins;
    this.extensionRuntime = extensionRuntime && typeof extensionRuntime === "object" ? extensionRuntime : {};
    this.normalizeStringArray =
      typeof normalizeStringArray === "function" ? normalizeStringArray : (input) => input;
    this.mergeHarnessExtensionOptions =
      typeof mergeModelExtensionOptions === "function"
        ? mergeModelExtensionOptions
        : typeof mergeHarnessExtensionOptions === "function"
          ? mergeHarnessExtensionOptions
        : (...items) => Object.assign({}, ...items.filter((item) => item && typeof item === "object"));
    this.createHarnessResolveModelMessages =
      createExtensionResolveModelMessages || createHarnessResolveModelMessages;
    this.createHarnessResolveMessageBlock =
      createExtensionResolveMessageBlock || createHarnessResolveMessageBlock;
    this.createHarnessMarkMessagesSummarized =
      createExtensionMarkMessagesSummarized || createHarnessMarkMessagesSummarized;
    this.createBotSubSessionRunner =
      createDetachedSubSessionRunner || createBotSubSessionRunner;
    this.createGeneratedArtifactPersister = createGeneratedArtifactPersister;
    this.createWorkflowScopedJsonWriter = createScopedJsonWriter || createWorkflowScopedJsonWriter;
    this.createWorkflowScopedEventLogger = createScopedEventLogger || createWorkflowScopedEventLogger;
  }

  prepareRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const preparedHarnessConfig = this.prepareHarnessRunConfig({
      userId,
      runConfig,
      userConfig,
    });
    const preparedBotHookConfig = this.prepareBotHookRunConfig({
      runConfig: preparedHarnessConfig,
    });
    return this.prepareWorkflowRunConfig({
      userId,
      runConfig: preparedBotHookConfig,
      userConfig,
    });
  }

  resolveHarnessPluginOptions({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const { harnessPluginSelectors = new Set(["harness"]) } = this.extensionRuntime;
    const effectiveConfig = mergeConfig(
      this.globalConfig || {},
      userConfig && typeof userConfig === "object" ? userConfig : {},
    );
    const effectiveHarness = resolvePluginOptionsFromConfig(
      effectiveConfig,
      harnessPluginSelectors,
    );
    if (effectiveHarness?.enabled === false) return { enabled: false, mode: "off" };
    const runHarness = resolvePluginOptionsFromConfig(
      runConfig,
      harnessPluginSelectors,
    );
    if (runHarness?.enabled === false) return { enabled: false, mode: "off" };
    const selectedPlugins = Array.isArray(runConfig?.selectedPlugins)
      ? runConfig.selectedPlugins
      : [];
    const harnessSelected = selectedPlugins.some((item) =>
      harnessPluginSelectors.has(String(item || "").trim()),
    );
    const options = this.mergeHarnessExtensionOptions(
      effectiveHarness,
      runHarness,
    );
    const normalizedMode = String(harnessSelected ? "on" : options?.mode ?? "off")
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
    next.resolveModelMessages = this.createHarnessResolveModelMessages({
      harnessOptions: next,
    });
    next.resolveMessageBlock = this.createHarnessResolveMessageBlock({
      harnessOptions: next,
    });
    next.markMessagesSummarized = this.createHarnessMarkMessagesSummarized();
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

  prepareHarnessRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const { harnessPluginKey = "harness" } = this.extensionRuntime;
    const harnessOptions = this.resolveHarnessPluginOptions({
      userId,
      runConfig,
      userConfig,
    });
    if (!harnessOptions.enabled) return runConfig;
    return this.prepareRegisteredPluginRunConfig({
      runConfig,
      options: harnessOptions,
      pluginName: harnessPluginKey,
      capability: PLUGIN_CAPABILITY.AGENT_REGISTER,
      managerKey: "hookManager",
      hooksKey: "hooks",
      runtimeKey: "harness",
      registrationFlag: "__noobotHarnessPluginRegistered",
      createManager: createAgentHookManager,
    });
  }

  resolveWorkflowPluginOptions({ runConfig = {}, userConfig = {} } = {}) {
    const { workflowPluginSelectors = new Set(["workflow"]) } = this.extensionRuntime;
    const effectiveConfig = mergeConfig(
      this.globalConfig || {},
      userConfig && typeof userConfig === "object" ? userConfig : {},
    );
    const effectiveWorkflow = resolvePluginOptionsFromConfig(
      effectiveConfig,
      workflowPluginSelectors,
    );
    if (effectiveWorkflow?.enabled === false) return { enabled: false, mode: "off" };
    const runWorkflow = resolvePluginOptionsFromConfig(
      runConfig,
      workflowPluginSelectors,
    );
    if (runWorkflow?.enabled === false) return { enabled: false, mode: "off" };
    const selectedPlugins = Array.isArray(runConfig?.selectedPlugins)
      ? runConfig.selectedPlugins
      : [];
    const workflowSelected = selectedPlugins.some((item) =>
      workflowPluginSelectors.has(String(item || "").trim()),
    );
    const normalizedEffectiveMode = String(effectiveWorkflow?.mode ?? "off")
      .trim()
      .toLowerCase();
    const normalizedRunMode = String(runWorkflow?.mode ?? "")
      .trim()
      .toLowerCase();
    // keep user/global on as baseline; runConfig should primarily elevate workflow,
    // unless it explicitly disables plugin via enabled=false (used by node sub-session strategy)
    const resolvedMode =
      workflowSelected || normalizedRunMode === "on" || normalizedEffectiveMode === "on"
        ? "on"
        : "off";
    if (resolvedMode !== "on") return { enabled: false, mode: "off" };
    const options = {
      ...(effectiveWorkflow && typeof effectiveWorkflow === "object" ? effectiveWorkflow : {}),
      ...(runWorkflow && typeof runWorkflow === "object" ? runWorkflow : {}),
    };
    const next = { ...options, enabled: true, mode: "on" };
    next.miniRunnerMaxTurns = BUILTIN_THRESHOLDS.workflow.miniRunnerMaxTurns;
    next.maxAutoTransitions = BUILTIN_THRESHOLDS.workflow.maxAutoTransitions;
    next.resolveModelMessages = this.createHarnessResolveModelMessages({
      harnessOptions: next,
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
        headerNamespace: "workflow",
        flowPrefix: "workflow",
        includeHarnessCompatHeaders: true,
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
    if (typeof next?.workflowDialogPersister !== "function") {
      next.workflowDialogPersister = this.createWorkflowScopedJsonWriter();
    }
    if (typeof next?.workflowEventLogger !== "function") {
      next.workflowEventLogger = this.createWorkflowScopedEventLogger();
    }
    return next;
  }

  prepareWorkflowRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const { workflowPluginKey = "workflow" } = this.extensionRuntime;
    const workflowOptions = this.resolveWorkflowPluginOptions({
      userId,
      runConfig,
      userConfig,
    });
    if (!workflowOptions.enabled) return runConfig;
    return this.prepareRegisteredPluginRunConfig({
      runConfig,
      options: workflowOptions,
      pluginName: workflowPluginKey,
      capability: PLUGIN_CAPABILITY.BOT_REGISTER,
      managerKey: "botHookManager",
      hooksKey: "botHooks",
      runtimeKey: "workflow",
      registrationFlag: "__noobotWorkflowPluginRegistered",
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
    const alreadyRegistered = manager?.[registrationFlag] === true;
    if (!alreadyRegistered) {
      const registerPlugin = resolvePluginRegisterByCapability(
        this.loadedDynamicPlugins,
        capability,
      );
      if (typeof registerPlugin === "function") {
        registerPlugin(pluginApi, options);
        Object.defineProperty(manager, registrationFlag, {
          value: true,
          enumerable: false,
          configurable: true,
        });
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
