/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createHookManager,
  hookPointDomain,
  HOOK_POINT_DOMAIN,
  isHookPointInDomain,
} from "@noobot/hook-protocol";
import { deriveAgentExecutionId, EXECUTION_KIND } from "@noobot/session-protocol";
import {
  contributionsForSurface,
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
import { selectHookManager } from "./session-execution-engine-utils.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { commitPluginArtifact, getPluginArtifact } from "./plugin-artifact-committer.js";
import { isPlainObject, text, isFunction } from "@noobot/shared/value";

export const AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS = TURN_THRESHOLDS.capability.miniRunnerMaxToolTurns;
export const AGENT_PLUGIN_HARNESS_HOOK_MIN_TIMEOUT_MS =
  TIME_THRESHOLDS.capability.harnessHookMinTimeoutMs;

function plainObject(value) {
  return isPlainObject(value) ? value : {};
}

function requireTurnScopeId(turnScopeId = "") {
  const scopeId = text(turnScopeId);
  if (!scopeId) throw new TypeError("execution intent requires turnScopeId");
  return scopeId;
}

function requireUserId(userId = "") {
  const normalized = text(userId);
  if (!normalized) throw new TypeError("plugin basePath resolution requires userId");
  return normalized;
}

function assertPreparerInput({
  globalConfig,
  workspaceService,
  loadedDynamicPlugins,
  createPluginResolveModelMessages,
  createDetachedSubSessionRunner,
}) {
  if (!isPlainObject(globalConfig)) {
    throw new TypeError("RunConfigPluginPreparer requires globalConfig object");
  }
  if (!isFunction(workspaceService?.getWorkspacePath)) {
    throw new TypeError("RunConfigPluginPreparer requires workspaceService.getWorkspacePath");
  }
  if (!(loadedDynamicPlugins?.registry instanceof Map)) {
    throw new TypeError("RunConfigPluginPreparer requires loadedDynamicPlugins.registry Map");
  }
  if (!isFunction(createPluginResolveModelMessages)) {
    throw new TypeError("RunConfigPluginPreparer requires createPluginResolveModelMessages");
  }
  if (!isFunction(createDetachedSubSessionRunner)) {
    throw new TypeError("RunConfigPluginPreparer requires createDetachedSubSessionRunner");
  }
}

function createRootExecutionIntent({ executionId, executionKind, origin, stage }) {
  return Object.freeze({
    executionId,
    executionKind,
    parentExecutionId: "",
    rootExecutionId: executionId,
    origin: Object.freeze(origin),
    stage,
  });
}

function managerForPoint(point = "", agentHooks, orchestrationHooks) {
  const domain = hookPointDomain(point);
  return domain === HOOK_POINT_DOMAIN.BOT || domain === HOOK_POINT_DOMAIN.WORKFLOW
    ? orchestrationHooks
    : agentHooks;
}

export class RunConfigPluginPreparer {
  constructor(input) {
    assertPreparerInput(input);
    const {
      globalConfig,
      workspaceService,
      loadedDynamicPlugins,
      createPluginResolveModelMessages,
      createDetachedSubSessionRunner,
    } = input;
    this.globalConfig = globalConfig;
    this.workspaceService = workspaceService;
    this.loadedDynamicPlugins = loadedDynamicPlugins;
    this.createPluginResolveModelMessages = createPluginResolveModelMessages;
    this.createDetachedSubSessionRunner = createDetachedSubSessionRunner;
  }

  selectedEntries({ runConfig = {}, userConfig = {} } = {}) {
    const { entries, plan } = this.createConfigPlan({ runConfig, userConfig });
    const selected = new Set(plan.plugins.map((plugin) => plugin.pluginId));
    return entries.filter((entry) => selected.has(entry.pluginId));
  }

  createConfigPlan({ runConfig = {}, userConfig = {} } = {}) {
    const effectiveConfig = mergeConfig(this.globalConfig, plainObject(userConfig));
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
    const scopeId = requireTurnScopeId(turnScopeId);
    const declaration = declarations[0];
    if (!declaration) {
      return createRootExecutionIntent({
        executionId: deriveAgentExecutionId({ turnScopeId: scopeId }),
        executionKind: EXECUTION_KIND.AGENT,
        origin: {},
        stage: "",
      });
    }
    const executionId = `${declaration.idPrefix}:${scopeId}`;
    return createRootExecutionIntent({
      executionId,
      executionKind: declaration.kind,
      origin: { type: declaration.originType, [declaration.originIdKey]: executionId },
      stage: text(declaration.stage),
    });
  }

  resolveOptions({ entry, userId = "", runConfig = {}, userConfig = {} }) {
    const effectiveConfig = mergeConfig(this.globalConfig, plainObject(userConfig));
    const configSnapshot = createConfigSnapshot({
      config: effectiveConfig,
      scope: { kind: "agent_turn", userId: text(userId) },
    });
    const plan = createPluginConfigPlan({
      runConfig,
      effectiveConfig,
      manifests: [{ pluginId: entry.pluginId, defaults: entry.manifest.configuration?.defaults }],
    });
    const options =
      plan.plugins.find((plugin) => plugin.pluginId === entry.pluginId)?.options || {};
    const basePath =
      text(options.basePath) || this.workspaceService.getWorkspacePath(requireUserId(userId));
    const next = { ...options, enabled: true, mode: "on", basePath };
    next.frontendThresholdsEnabled = runConfig.frontendThresholdsEnabled;
    const agentContributions = contributionsForSurface(entry.manifest, PLUGIN_SURFACE.AGENT);
    const registeredHooks = agentContributions?.hooks?.registers || [];
    const hasAgentLifecycle = registeredHooks.some(({ point }) =>
      isHookPointInDomain(point, HOOK_POINT_DOMAIN.AGENT),
    );
    const hasExecutionIntent = Boolean(agentContributions?.executionIntent);

    if (hasAgentLifecycle || hasExecutionIntent) {
      next.miniRunnerMaxTurns =
        Number.isFinite(Number(next.miniRunnerMaxTurns)) && Number(next.miniRunnerMaxTurns) > 0
          ? Math.min(Number(next.miniRunnerMaxTurns), AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS)
          : AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS;
      next.resolveModelMessages = this.createPluginResolveModelMessages();
    }

    if (hasAgentLifecycle) {
      if (
        !Number.isFinite(Number(next.timeoutMs)) ||
        Number(next.timeoutMs) < AGENT_PLUGIN_HARNESS_HOOK_MIN_TIMEOUT_MS
      ) {
        next.timeoutMs = AGENT_PLUGIN_HARNESS_HOOK_MIN_TIMEOUT_MS;
      }
      next.capabilityModelInvoker = createAgentCapabilityModelInvoker({
        maxTurns: next.miniRunnerMaxTurns,
        enableToolBinding: false,
        pluginId: entry.pluginId,
        configSnapshot,
      });
    }

    if (hasExecutionIntent) {
      next.capabilityModelInvoker = createAgentCapabilityModelInvoker({
        maxTurns: next.miniRunnerMaxTurns,
        enableToolBinding: false,
        pluginId: entry.pluginId,
        configSnapshot,
      });
      next.subSessionRunner = this.createDetachedSubSessionRunner();
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
        hookManager: null,
        botHookManager: null,
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
    const policy = createPluginPolicyApi({ baseToolPolicy: runConfig?.toolPolicy });
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
            [PLUGIN_HOST_PORT.ARTIFACTS_GET]: {
              path: ["artifacts", "get"],
              value: (artifact, toolContext) =>
                getPluginArtifact({ pluginId: entry.pluginId, artifact, toolContext }),
            },
            [PLUGIN_HOST_PORT.TOOLS_REGISTER]: {
              path: ["tools", "register"],
              value: (toolId, factory) => {
                const declaration = requireDeclaredPluginTool(entry.manifest, toolId);
                if (!isFunction(factory))
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
            }),
          }
        : {}),
      plugins: configuredPlugins,
      pluginTools,
    };
  }
}
