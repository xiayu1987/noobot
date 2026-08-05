/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHookManager } from "@noobot/hook-protocol";
import {
  PLUGIN_SURFACE,
  requireDeclaredPluginHook,
  requireDeclaredPluginHookEmission,
  validatePluginActivationResult,
} from "@noobot/plugin-protocol";
import { listLoadedNoobotPluginEntries, resolvePluginExecutionIntent } from "@noobot/plugin-runtime";
import { mergeConfig } from "../../config/index.js";
import { createAgentCapabilityModelInvoker } from "../../runtime/capability-runner/index.js";
import { createPluginPolicyApi, hasToolPolicyPatchContent, mergeToolPolicyPatch } from "./plugin-policy-api.js";
import { normalizeTrimmedStringList, selectHookManager } from "./session-execution-engine-utils.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS = TURN_THRESHOLDS.capability.miniRunnerMaxToolTurns;
export const AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS = TIME_THRESHOLDS.capability.separateModelMinTimeoutMs;

const activationsByManager = new WeakMap();

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pluginConfig(source = {}, pluginId = "") {
  return plainObject(plainObject(source?.plugins)[pluginId]);
}

function pluginModelConfig(source = {}, pluginId = "") {
  return plainObject(plainObject(source?.pluginModelConfig)[pluginId]);
}

function pluginIsSelected({ pluginId, runConfig, effectiveConfig }) {
  const disabled = new Set(normalizeTrimmedStringList(runConfig?.disabledPlugins));
  if (disabled.has(pluginId)) return false;
  const selected = new Set(normalizeTrimmedStringList(runConfig?.selectedPlugins));
  if (selected.has(pluginId)) return true;
  return pluginConfig(runConfig, pluginId).mode === "on" || pluginConfig(effectiveConfig, pluginId).mode === "on";
}

function createAgentExecutionIntent({ runConfig = {}, turnScopeId = "" } = {}) {
  const scopeId = String(turnScopeId || runConfig?.turnScopeId || "").trim();
  const executionId = String(runConfig?.executionId || `agent:${scopeId}`).trim();
  return Object.freeze({
    executionId,
    executionKind: "agent",
    parentExecutionId: String(runConfig?.parentExecutionId || "").trim(),
    rootExecutionId: String(runConfig?.rootExecutionId || executionId).trim(),
    origin: Object.freeze(plainObject(runConfig?.origin)),
    stage: String(runConfig?.stage || "").trim(),
  });
}

function managerForPoint(point = "", agentHooks, orchestrationHooks) {
  const normalized = String(point || "").trim();
  return normalized.startsWith("bot.") || normalized.startsWith("workflow.")
    ? orchestrationHooks
    : agentHooks;
}

function scopeHandlerId(pluginId = "", handlerId = "") {
  const normalized = String(handlerId || "").trim();
  if (!normalized) throw new TypeError(`plugin ${pluginId} hook handler id is required`);
  return `${pluginId}:${normalized}`;
}

export class RunConfigPluginPreparer {
  constructor({
    globalConfig = {},
    workspaceService = null,
    loadedDynamicPlugins = null,
    normalizeStringArray = null,
    mergePluginOptions = null,
    createPluginResolveModelMessages = null,
    createDetachedSubSessionRunner = null,
    createBotSubSessionRunner = null,
    createGeneratedArtifactPersister = null,
  } = {}) {
    this.globalConfig = globalConfig;
    this.workspaceService = workspaceService;
    this.loadedDynamicPlugins = loadedDynamicPlugins;
    this.normalizeStringArray = typeof normalizeStringArray === "function" ? normalizeStringArray : normalizeTrimmedStringList;
    this.mergePluginOptions = typeof mergePluginOptions === "function"
      ? mergePluginOptions
      : (...items) => Object.assign({}, ...items.map(plainObject));
    this.createPluginResolveModelMessages = createPluginResolveModelMessages;
    this.createDetachedSubSessionRunner = createDetachedSubSessionRunner || createBotSubSessionRunner;
    this.createGeneratedArtifactPersister = createGeneratedArtifactPersister;
  }

  selectedEntries({ runConfig = {}, userConfig = {} } = {}) {
    const effectiveConfig = mergeConfig(this.globalConfig || {}, plainObject(userConfig));
    return listLoadedNoobotPluginEntries(this.loadedDynamicPlugins).filter((entry) =>
      pluginIsSelected({ pluginId: entry.pluginId, runConfig, effectiveConfig }),
    );
  }

  resolveExecutionIntent({ runConfig = {}, userConfig = {}, turnScopeId = "" } = {}) {
    const selected = this.selectedEntries({ runConfig, userConfig });
    const declarations = selected
      .map((entry) => resolvePluginExecutionIntent(this.loadedDynamicPlugins, entry.pluginId))
      .filter(Boolean);
    if (declarations.length > 1) {
      throw new Error(`multiple selected plugins declare execution intent: ${declarations.map((item) => item.pluginId).join(", ")}`);
    }
    const declaration = declarations[0];
    if (!declaration) return createAgentExecutionIntent({ runConfig, turnScopeId });
    const scopeId = String(turnScopeId || runConfig?.turnScopeId || "").trim();
    const executionId = String(runConfig?.executionId || `${declaration.idPrefix}:${scopeId}`).trim();
    return Object.freeze({
      executionId,
      executionKind: declaration.kind,
      parentExecutionId: String(runConfig?.parentExecutionId || "").trim(),
      rootExecutionId: String(runConfig?.rootExecutionId || executionId).trim(),
      origin: Object.freeze({ type: declaration.originType, [declaration.originIdKey]: executionId }),
      stage: String(declaration.stage || "").trim(),
    });
  }

  resolveOptions({ entry, userId = "", runConfig = {}, userConfig = {} }) {
    const effectiveConfig = mergeConfig(this.globalConfig || {}, plainObject(userConfig));
    const modelConfig = pluginModelConfig(runConfig, entry.pluginId);
    const options = this.mergePluginOptions(
      entry.manifest.configuration?.defaults,
      pluginConfig(effectiveConfig, entry.pluginId),
      pluginConfig(runConfig, entry.pluginId),
      modelConfig,
    );
    const basePath = String(options.basePath || "").trim() || (
      this.workspaceService && userId ? this.workspaceService.getWorkspacePath(userId) : ""
    );
    const next = { ...options, enabled: true, mode: "on", basePath };
    const registeredHooks = entry.manifest.contributes.agent?.hooks?.registers || [];
    const hasAgentLifecycle = registeredHooks.some((point) => point.startsWith("agent."));
    const hasExecutionIntent = Boolean(entry.manifest.contributes.agent?.executionIntent);

    if (hasAgentLifecycle) {
      next.resolveModelMessages = this.createPluginResolveModelMessages?.({ pluginId: entry.pluginId, pluginOptions: next });
      next.miniRunnerMaxTurns = Number.isFinite(Number(next.miniRunnerMaxTurns)) && Number(next.miniRunnerMaxTurns) > 0
        ? Math.min(Number(next.miniRunnerMaxTurns), AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS)
        : AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS;
      next.planningGuidanceMode = String(next.planningGuidanceMode || "separate_model");
      if (next.planningGuidanceMode === "separate_model") {
        if (!Number.isFinite(Number(next.timeoutMs)) || Number(next.timeoutMs) < AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS) {
          next.timeoutMs = AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS;
        }
        if (typeof next.capabilityModelInvoker !== "function") {
          next.capabilityModelInvoker = createAgentCapabilityModelInvoker({ maxTurns: next.miniRunnerMaxTurns, enableToolBinding: false });
        }
      }
    }

    if (hasExecutionIntent) {
      next.resolveModelMessages = this.createPluginResolveModelMessages?.({ pluginId: entry.pluginId, pluginOptions: next });
      next.semanticMode = String(next.semanticMode || "separate_model");
      if (next.semanticMode === "separate_model" && typeof next.capabilityModelInvoker !== "function") {
        next.capabilityModelInvoker = createAgentCapabilityModelInvoker({
          maxTurns: next.miniRunnerMaxTurns,
          enableToolBinding: false,
          headerNamespace: "plugin",
          flowPrefix: entry.pluginId,
          fallbackGlobalConfig: this.globalConfig || {},
          fallbackUserConfig: plainObject(userConfig),
        });
      }
      if (typeof next.subSessionRunner !== "function") next.subSessionRunner = this.createDetachedSubSessionRunner?.();
      if (typeof next.generatedArtifactPersister !== "function") next.generatedArtifactPersister = this.createGeneratedArtifactPersister?.();
    }
    return next;
  }

  prepareRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    const entries = this.selectedEntries({ runConfig, userConfig });
    const agentHooks = selectHookManager({ runConfig, managerKey: "hookManager", createManager: createHookManager });
    const orchestrationHooks = selectHookManager({ runConfig, managerKey: "botHookManager", createManager: createHookManager });
    const policy = createPluginPolicyApi({
      baseToolPolicy: runConfig?.toolPolicy,
      normalizeStringArray: (input) => this.normalizeStringArray(input),
    });
    const configuredPlugins = { ...plainObject(runConfig?.plugins) };
    const activated = activationsByManager.get(agentHooks) || new Map();
    const pluginLifecycleEvents = [];

    for (const entry of entries) {
      const options = this.resolveOptions({ entry, userId, runConfig, userConfig });
      configuredPlugins[entry.pluginId] = options;
      if (activated.has(entry.pluginId)) continue;
      const host = Object.freeze({
        hooks: Object.freeze({
          register: (point, handler, registrationOptions = {}) => {
            requireDeclaredPluginHook(entry.manifest, PLUGIN_SURFACE.AGENT, point);
            const manager = managerForPoint(point, agentHooks, orchestrationHooks);
            return manager.on(point, handler, {
              ...registrationOptions,
              id: scopeHandlerId(entry.pluginId, registrationOptions?.id),
            });
          },
          emit: (point, payload, emitOptions) => {
            requireDeclaredPluginHookEmission(entry.manifest, PLUGIN_SURFACE.AGENT, point);
            return managerForPoint(point, agentHooks, orchestrationHooks).emit(point, payload, emitOptions);
          },
        }),
        policy: Object.freeze({ patch: (patch) => policy.patch(patch) }),
      });
      let result;
      try {
        result = entry.activate(host, options);
        if (result && typeof result.then === "function") {
          throw new TypeError(`agent plugin ${entry.pluginId} activate must be synchronous`);
        }
        activated.set(entry.pluginId, validatePluginActivationResult(result, {
          pluginId: entry.pluginId,
          surface: PLUGIN_SURFACE.AGENT,
        }));
      } catch (error) {
        error.pluginLifecycleEvent = {
          event: "plugin.failed",
          data: {
            pluginId: entry.pluginId,
            pluginVersion: entry.manifest.version,
            protocolVersion: entry.manifest.protocolVersion,
            surface: PLUGIN_SURFACE.AGENT,
            errorCode: String(error?.code || "PLUGIN_ACTIVATION_FAILED"),
            message: String(error?.message || error),
          },
        };
        throw error;
      }
      pluginLifecycleEvents.push({
        event: "plugin.activated",
        data: {
          pluginId: entry.pluginId,
          pluginVersion: entry.manifest.version,
          protocolVersion: entry.manifest.protocolVersion,
          surface: PLUGIN_SURFACE.AGENT,
        },
      });
      pluginLifecycleEvents.push({
        event: "plugin.contribution_committed",
        data: {
          pluginId: entry.pluginId,
          pluginVersion: entry.manifest.version,
          protocolVersion: entry.manifest.protocolVersion,
          surface: PLUGIN_SURFACE.AGENT,
          hookCount: entry.manifest.contributes.agent?.hooks?.registers?.length || 0,
        },
      });
    }
    activationsByManager.set(agentHooks, activated);

    const toolPolicyPatch = policy.snapshot();
    const shouldAttachPolicy = Object.keys(plainObject(runConfig?.toolPolicy)).length > 0
      || hasToolPolicyPatchContent({ toolPolicyPatch, normalizeStringArray: (input) => this.normalizeStringArray(input) });
    return {
      ...runConfig,
      hookManager: agentHooks,
      botHookManager: orchestrationHooks,
      pluginLifecycleEvents,
      ...(shouldAttachPolicy ? {
        toolPolicy: mergeToolPolicyPatch({
          baseToolPolicy: runConfig?.toolPolicy,
          toolPolicyPatch,
          normalizeStringArray: (input) => this.normalizeStringArray(input),
        }),
      } : {}),
      plugins: configuredPlugins,
    };
  }
}
