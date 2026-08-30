/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHookManager } from "@noobot/hook-protocol";
import {
  PLUGIN_HOST_PORT,
  PLUGIN_SURFACE,
  requireDeclaredPluginHook,
  requireDeclaredPluginHookEmission,
  requireDeclaredPluginTool,
  serializePluginContributionIdentity,
} from "@noobot/plugin-protocol";
import {
  createContributionTransaction,
  createPluginActivationScopeSync,
  createPluginHostFacade,
  listLoadedNoobotPluginEntries,
  resolvePluginExecutionIntent,
} from "@noobot/plugin-runtime";
import {
  mergeConfig,
  createPluginPolicyApi,
  hasToolPolicyPatchContent,
  mergeToolPolicyPatch,
  createPluginConfigPlan,
  createConfigSnapshot,
} from "@noobot/agent-config-protocol";
import { createAgentCapabilityModelInvoker } from "../../runtime/capability-runner/index.js";
import { normalizeTrimmedStringList, selectHookManager } from "./session-execution-engine-utils.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { commitPluginArtifact } from "./plugin-artifact-committer.js";

export const AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS = TURN_THRESHOLDS.capability.miniRunnerMaxToolTurns;
export const AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS =
  TIME_THRESHOLDS.capability.separateModelMinTimeoutMs;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

export class RunConfigPluginPreparer {
  constructor({
    globalConfig = {},
    workspaceService = null,
    loadedDynamicPlugins = null,
    normalizeStringArray = null,
    createPluginResolveModelMessages = null,
    createDetachedSubSessionRunner = null,
    createBotSubSessionRunner = null,
    createGeneratedArtifactPersister = null,
  } = {}) {
    this.globalConfig = globalConfig;
    this.workspaceService = workspaceService;
    this.loadedDynamicPlugins = loadedDynamicPlugins;
    this.normalizeStringArray =
      typeof normalizeStringArray === "function"
        ? normalizeStringArray
        : normalizeTrimmedStringList;
    this.createPluginResolveModelMessages = createPluginResolveModelMessages;
    this.createDetachedSubSessionRunner =
      createDetachedSubSessionRunner || createBotSubSessionRunner;
    this.createGeneratedArtifactPersister = createGeneratedArtifactPersister;
  }

  selectedEntries({ runConfig = {}, userConfig = {} } = {}) {
    const { entries, plan } = this.createConfigPlan({ runConfig, userConfig });
    const selected = new Set(plan.plugins.map((plugin) => plugin.pluginId));
    return entries.filter((entry) => selected.has(entry.pluginId));
  }

  createConfigPlan({ runConfig = {}, userConfig = {} } = {}) {
    const effectiveConfig = mergeConfig(this.globalConfig || {}, plainObject(userConfig));
    const entries = listLoadedNoobotPluginEntries(this.loadedDynamicPlugins);
    const plan = createPluginConfigPlan({
      runConfig,
      effectiveConfig,
      manifests: entries.map((entry) => ({
        pluginId: entry.pluginId,
        defaults: entry.manifest.configuration?.defaults,
      })),
    });
    return { entries, plan };
  }

  resolveExecutionIntent({ runConfig = {}, userConfig = {}, turnScopeId = "" } = {}) {
    const selected = this.selectedEntries({ runConfig, userConfig });
    const declarations = selected
      .map((entry) => resolvePluginExecutionIntent(this.loadedDynamicPlugins, entry.pluginId))
      .filter(Boolean);
    if (declarations.length > 1) {
      throw new Error(
        `multiple selected plugins declare execution intent: ${declarations.map((item) => item.pluginId).join(", ")}`,
      );
    }
    const declaration = declarations[0];
    if (!declaration) return createAgentExecutionIntent({ runConfig, turnScopeId });
    const scopeId = String(turnScopeId || runConfig?.turnScopeId || "").trim();
    const executionId = String(
      runConfig?.executionId || `${declaration.idPrefix}:${scopeId}`,
    ).trim();
    return Object.freeze({
      executionId,
      executionKind: declaration.kind,
      parentExecutionId: String(runConfig?.parentExecutionId || "").trim(),
      rootExecutionId: String(runConfig?.rootExecutionId || executionId).trim(),
      origin: Object.freeze({
        type: declaration.originType,
        [declaration.originIdKey]: executionId,
      }),
      stage: String(declaration.stage || "").trim(),
    });
  }

  resolveOptions({ entry, userId = "", runConfig = {}, userConfig = {} }) {
    const effectiveConfig = mergeConfig(this.globalConfig || {}, plainObject(userConfig));
    const configSnapshot = createConfigSnapshot({
      config: effectiveConfig,
      scope: { kind: "agent_turn", userId: String(userId || "").trim() },
    });
    const plan = createPluginConfigPlan({
      runConfig,
      effectiveConfig,
      manifests: [{ pluginId: entry.pluginId, defaults: entry.manifest.configuration?.defaults }],
    });
    const options =
      plan.plugins.find((plugin) => plugin.pluginId === entry.pluginId)?.options || {};
    const basePath =
      String(options.basePath || "").trim() ||
      (this.workspaceService && userId ? this.workspaceService.getWorkspacePath(userId) : "");
    const next = { ...options, enabled: true, mode: "on", basePath };
    next.frontendThresholdsEnabled = runConfig?.frontendThresholdsEnabled === true;
    const registeredHooks = entry.manifest.contributes.agent?.hooks?.registers || [];
    const hasAgentLifecycle = registeredHooks.some(({ point }) => point.startsWith("agent."));
    const hasExecutionIntent = Boolean(entry.manifest.contributes.agent?.executionIntent);

    if (hasAgentLifecycle) {
      next.resolveModelMessages = this.createPluginResolveModelMessages?.({
        pluginId: entry.pluginId,
        pluginOptions: next,
      });
      next.miniRunnerMaxTurns =
        Number.isFinite(Number(next.miniRunnerMaxTurns)) && Number(next.miniRunnerMaxTurns) > 0
          ? Math.min(Number(next.miniRunnerMaxTurns), AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS)
          : AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS;
      next.planningGuidanceMode = String(next.planningGuidanceMode || "separate_model");
      if (next.planningGuidanceMode === "separate_model") {
        if (
          !Number.isFinite(Number(next.timeoutMs)) ||
          Number(next.timeoutMs) < AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS
        ) {
          next.timeoutMs = AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS;
        }
        if (typeof next.capabilityModelInvoker !== "function") {
          next.capabilityModelInvoker = createAgentCapabilityModelInvoker({
            maxTurns: next.miniRunnerMaxTurns,
            enableToolBinding: false,
            configSnapshot,
          });
        }
      }
    }

    if (hasExecutionIntent) {
      next.resolveModelMessages = this.createPluginResolveModelMessages?.({
        pluginId: entry.pluginId,
        pluginOptions: next,
      });
      next.semanticMode = String(next.semanticMode || "separate_model");
      if (
        next.semanticMode === "separate_model" &&
        typeof next.capabilityModelInvoker !== "function"
      ) {
        next.capabilityModelInvoker = createAgentCapabilityModelInvoker({
          maxTurns: next.miniRunnerMaxTurns,
          enableToolBinding: false,
          headerNamespace: "plugin",
          flowPrefix: entry.pluginId,
          configSnapshot,
        });
      }
      if (typeof next.subSessionRunner !== "function")
        next.subSessionRunner = this.createDetachedSubSessionRunner?.();
      if (typeof next.generatedArtifactPersister !== "function")
        next.generatedArtifactPersister = this.createGeneratedArtifactPersister?.();
    }
    return next;
  }

  prepareRunConfig({ userId = "", runConfig = {}, userConfig = {} } = {}) {
    runConfig?.pluginActivationScope?.dispose?.();
    const { entries: loadedEntries, plan } = this.createConfigPlan({ runConfig, userConfig });
    const selected = new Set(plan.plugins.map((plugin) => plugin.pluginId));
    const entries = loadedEntries.filter((entry) => selected.has(entry.pluginId));
    if (plan.pluginsDisabled) {
      return {
        ...runConfig,
        selectedPlugins: plan.selectedPlugins,
        disabledPlugins: plan.disabledPlugins,
        plugins: {},
      };
    }
    const agentHooks = selectHookManager({
      runConfig,
      managerKey: "hookManager",
      createManager: createHookManager,
    });
    const orchestrationHooks = selectHookManager({
      runConfig,
      managerKey: "botHookManager",
      createManager: createHookManager,
    });
    const policy = createPluginPolicyApi({
      baseToolPolicy: runConfig?.toolPolicy,
      normalizeStringArray: (input) => this.normalizeStringArray(input),
    });
    const configuredPlugins = { ...plainObject(runConfig?.plugins) };
    const pluginTools = [];
    for (const entry of entries) {
      const options = this.resolveOptions({ entry, userId, runConfig, userConfig });
      configuredPlugins[entry.pluginId] = options;
    }
    const pluginLifecycleEvents = [];
    const pluginActivationScope = createPluginActivationScopeSync({
      entries,
      lifecycleSink: (record) => pluginLifecycleEvents.push(record),
      configFactory: (entry) => configuredPlugins[entry.pluginId],
      transactionFactory: () =>
        createContributionTransaction({
          commit: () => undefined,
          rollback: (staged) => {
            for (const item of [...staged].reverse()) item.unregister?.();
          },
        }),
      hostFactory: (entry, transaction) =>
        createPluginHostFacade({
          entry,
          capabilityAdapters: {
            [PLUGIN_HOST_PORT.HOOKS_REGISTER]: {
              path: ["hooks", "register"],
              value(point, handler, registrationOptions = {}) {
                const declaration = requireDeclaredPluginHook(
                  entry.manifest,
                  PLUGIN_SURFACE.AGENT,
                  point,
                  registrationOptions?.id,
                );
                const manager = managerForPoint(point, agentHooks, orchestrationHooks);
                const unregister = manager.on(point, handler, {
                  ...registrationOptions,
                  id: serializePluginContributionIdentity({
                    pluginId: entry.pluginId,
                    surface: entry.surface,
                    localId: registrationOptions?.id,
                  }),
                });
                transaction.stage({
                  type: "hook",
                  point: declaration.point,
                  registrationId: declaration.id,
                  unregister,
                });
                return unregister;
              },
            },
            [PLUGIN_HOST_PORT.HOOKS_EMIT]: {
              path: ["hooks", "emit"],
              value(point, payload, emitOptions) {
                requireDeclaredPluginHookEmission(entry.manifest, PLUGIN_SURFACE.AGENT, point);
                return managerForPoint(point, agentHooks, orchestrationHooks).emit(
                  point,
                  payload,
                  emitOptions,
                );
              },
            },
            [PLUGIN_HOST_PORT.POLICY_PATCH]: {
              path: ["policy", "patch"],
              value: (patch) => policy.patch(patch),
            },
            [PLUGIN_HOST_PORT.ARTIFACTS_COMMIT]: {
              path: ["artifacts", "commit"],
              value: (artifact, toolContext) =>
                commitPluginArtifact({ pluginId: entry.pluginId, artifact, toolContext }),
            },
            [PLUGIN_HOST_PORT.TOOLS_REGISTER]: {
              path: ["tools", "register"],
              value: (toolId, factory) => {
                const declaration = requireDeclaredPluginTool(entry.manifest, toolId);
                if (typeof factory !== "function")
                  throw new TypeError(`plugin tool factory is required: ${toolId}`);
                if (pluginTools.some((item) => item.id === declaration.id)) {
                  throw new Error(`duplicate plugin tool: ${declaration.id}`);
                }
                const contribution = {
                  id: declaration.id,
                  name: declaration.name,
                  factory,
                  pluginId: entry.pluginId,
                };
                pluginTools.push(contribution);
                transaction.stage({ type: "tool", toolId: declaration.id });
                return contribution;
              },
            },
          },
        }),
    });

    const toolPolicyPatch = policy.snapshot();
    const shouldAttachPolicy =
      Object.keys(plainObject(runConfig?.toolPolicy)).length > 0 ||
      hasToolPolicyPatchContent({
        toolPolicyPatch,
        normalizeStringArray: (input) => this.normalizeStringArray(input),
      });
    return {
      ...runConfig,
      hookManager: agentHooks,
      botHookManager: orchestrationHooks,
      pluginLifecycleEvents,
      pluginActivationScope,
      ...(shouldAttachPolicy
        ? {
            toolPolicy: mergeToolPolicyPatch({
              baseToolPolicy: runConfig?.toolPolicy,
              toolPolicyPatch,
              normalizeStringArray: (input) => this.normalizeStringArray(input),
            }),
          }
        : {}),
      plugins: configuredPlugins,
      pluginTools,
    };
  }
}
