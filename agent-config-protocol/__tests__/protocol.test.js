/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPrimaryModelReferencesToConfigFile,
  assertConfigParamsDocumentKeys,
  ensureModelProviderInConfigFile,
  createConfigSnapshot,
  localizeBuiltinScenarios,
  mergeToolPolicyPatch,
  migrateConfigFileToCurrentProtocol,
  resolveBuiltinScenarios,
  RunConfigResolver,
  resolveToolBindings,
  validateConfigSnapshot,
  normalizeKnownConfigKeys,
  normalizeConfigParamsDocument,
  synchronizeConfigParamsDocument,
  mergeConfigParamLayers,
  buildConfigParamCatalog,
  createConfigValueLookup,
  resolveConfigTemplates,
  UNRESOLVED_TEMPLATE_POLICY,
  CONFIG_ERROR_CODE,
  createConfigBuildResult,
  applyConfigMigrations,
  validateEffectiveConfig,
  createPluginConfigPlan,
  selectModelAlias,
  resolveMultimodalDefaultModelSelection,
  DEPLOYMENT_OWNED_CONFIG_ROOT_KEYS,
  synchronizeConfigFileFromTemplate,
} from "../src/index.js";
test("config snapshot is versioned and validated", () => {
  const snapshot = createConfigSnapshot({ config: { x: 1 } });
  assert.equal(snapshot.protocol, "noobot.agent-config");
  assert.equal(validateConfigSnapshot(snapshot), snapshot);
});
test("config snapshot owns immutable metadata arrays", () => {
  const metadata = { migrations: ["v0"], warnings: ["legacy"], source: "test" };
  const snapshot = createConfigSnapshot({ metadata });

  assert.notEqual(snapshot.metadata.migrations, metadata.migrations);
  assert.notEqual(snapshot.metadata.warnings, metadata.warnings);
  assert.equal(Object.isFrozen(snapshot.metadata), true);
  assert.equal(Object.isFrozen(snapshot.metadata.migrations), true);
  assert.equal(Object.isFrozen(snapshot.metadata.warnings), true);
  assert.throws(() => snapshot.metadata.migrations.push("v1"), TypeError);
  metadata.migrations.push("caller-mutation");
  assert.deepEqual(snapshot.metadata.migrations, ["v0"]);
});

test("config snapshot rejects protocol and version drift", () => {
  assert.throws(
    () => validateConfigSnapshot({ protocol: "other", version: 1 }),
    /invalid agent config protocol/,
  );
  assert.throws(
    () => validateConfigSnapshot({ protocol: "noobot.agent-config", version: 2 }),
    /unsupported agent config protocol version/,
  );
});
test("tool policy is monotonic and deny wins", () => {
  const policy = mergeToolPolicyPatch({
    baseToolPolicy: { allowToolNames: ["read_file", "execute_script"] },
    toolPolicyPatch: { denyToolNames: ["execute_script"] },
  });
  assert.deepEqual(policy.allowToolNames, ["read_file"]);
  assert.deepEqual(policy.denyToolNames, ["execute_script"]);
});
test("built-in scenarios are resolved by protocol", () => {
  assert.equal(resolveBuiltinScenarios({}, {}).default, "full");
});
test("scenario localization requires an explicit adapter", () => {
  assert.throws(() => localizeBuiltinScenarios(resolveBuiltinScenarios()), /explicit translate/);
  const localized = localizeBuiltinScenarios(resolveBuiltinScenarios(), {
    locale: "en-US",
    translate: (key, locale, fallback) => `${locale}:${key}:${fallback}`,
  });
  assert.match(localized.definitions.programming.name, /^en-US:scenarios\.programming\.name:/);
});
test("programming required tools use the scenario protocol list and deny remains final", () => {
  const sourceTools = [
    "read_file",
    "write_file",
    "search",
    "patch_file",
    "execute_script",
    "execute_native_script",
    "multimodal_generate",
    "multimodal_parse",
    "other",
  ].map((name) => ({ name }));
  const tools = resolveToolBindings({
    sourceTools,
    runConfig: {
      scenario: "programming",
      toolPolicy: { allowToolNames: ["other"], denyToolNames: ["execute_script"] },
    },
  });
  assert.deepEqual(
    tools.map(({ name }) => name),
    [
      "read_file",
      "write_file",
      "search",
      "patch_file",
      "execute_native_script",
      "multimodal_generate",
      "multimodal_parse",
      "other",
    ],
  );
});
test("custom_only is not widened by programming scenario requirements", () => {
  const tools = resolveToolBindings({
    sourceTools: [{ name: "read_file" }],
    runConfig: {
      scenario: "programming",
      toolPolicy: {
        mode: "custom_only",
        customTools: [{ name: "custom" }],
        allowToolNames: ["custom"],
      },
    },
  });
  assert.deepEqual(
    tools.map(({ name }) => name),
    ["custom"],
  );
});

test("run config resolver uses the canonical default scenario and intersects explicit policy", () => {
  const resolver = new RunConfigResolver({
    globalConfig: {
      scenarios: {
        default: "programming",
      },
    },
  });
  const resolved = resolver.resolveScenarioRunConfig(
    {
      toolPolicy: { allowToolNames: ["write_file", "other"] },
      contextPolicy: { promptSections: ["base_prompt", "services"] },
    },
    {},
  );

  assert.equal(resolved.scenario, "programming");
  assert.ok(resolved.scenarioProfile.tools.includes("read_file"));
  assert.deepEqual(resolved.toolPolicy.allowToolNames, ["write_file"]);
  assert.equal(resolved.toolPolicy.forceIncludeUserInteraction, false);
  assert.deepEqual(resolved.contextPolicy.promptSections, ["base_prompt", "services"]);
});

test("tool binding adds user interaction once and keeps deny authoritative", () => {
  const tools = resolveToolBindings({
    sourceTools: [
      { name: "read_file" },
      { name: "user_interaction" },
      { name: "user_interaction" },
      { name: "write_file" },
    ],
    runConfig: {
      toolPolicy: {
        allowToolNames: ["read_file", "user_interaction", "write_file"],
        denyToolNames: ["user_interaction"],
      },
    },
  });

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["read_file", "write_file"],
  );
});

test("multimodal defaults resolve one explicit model across required modalities", () => {
  const config = normalizeKnownConfigKeys({
    multimodal: {
      parsing: {
        default_models: {
          image: "vision",
          document: "vision",
          audio: "omni",
        },
      },
    },
  });
  assert.deepEqual(
    resolveMultimodalDefaultModelSelection(config, {
      operation: "parsing",
      modalities: ["image", "document"],
    }),
    {
      operation: "parsing",
      modalities: ["image", "document"],
      alias: "vision",
      configuredAliases: ["vision"],
      missingModalities: [],
      conflicting: false,
    },
  );
  const conflict = resolveMultimodalDefaultModelSelection(config, {
    operation: "parsing",
    modalities: ["image", "audio"],
  });
  assert.equal(conflict.alias, "");
  assert.equal(conflict.conflicting, true);
});

test("primary model alignment updates every config-file model reference", () => {
  const config = {
    default_provider: "old",
    providers: { selected: { enabled: false, used_for_conversation: false } },
    multimodal: {
      parsing: { default_models: { audio: "old", image: "old", document: "old" } },
      generation: { default_models: { image: "old" } },
    },
    scenarios: { definitions: { programming: { model: "old" }, text: { model: "old" } } },
    tools: {
      web_search: { responses_api: { model: "old" } },
      request_help: { help_model: "" },
    },
    plugins: {
      harness: { stepModels: { planning: "old" } },
      workflow: { semanticModel: "old" },
    },
  };
  applyPrimaryModelReferencesToConfigFile(config, "selected");
  assert.equal(config.default_provider, "selected");
  assert.equal(config.providers.selected.enabled, true);
  assert.deepEqual(config.multimodal.parsing.default_models, {
    audio: "selected",
    image: "selected",
    document: "selected",
  });
  assert.equal(config.multimodal.generation.default_models.image, "selected");
  assert.equal(config.scenarios.definitions.programming.model, "selected");
  assert.equal(config.tools.web_search.responses_api.model, "selected");
  assert.equal(config.tools.request_help.help_model, "selected");
  assert.equal(config.plugins.harness.stepModels.planning, "selected");
  assert.equal(config.plugins.workflow.semanticModel, "selected");
});

test("model provider insertion uses the model library only when the alias is missing", () => {
  const config = {
    providers: {
      gpt_5_6_sol: { model: "configured-model", api_key: "configured-key" },
    },
  };
  const existing = ensureModelProviderInConfigFile(config, "gpt_5_6_sol");
  assert.equal(existing.model, "configured-model");
  assert.equal(existing.api_key, "configured-key");

  const inserted = ensureModelProviderInConfigFile(config, "gemini_3_7_flash");
  assert.equal(inserted.model, "gemini-3.7-flash");
  assert.equal(inserted.api_key, "${GEMINI_API_KEY}");
  inserted.model = "locally-mutated";
  const otherConfig = {};
  assert.equal(
    ensureModelProviderInConfigFile(otherConfig, "gemini_3_7_flash").model,
    "gemini-3.7-flash",
  );
  assert.throws(
    () => ensureModelProviderInConfigFile({}, "not_in_library"),
    /selected model provider not found/,
  );
});

test("current config migration removes every retired config path and prunes empty parents", () => {
  const config = {
    configParams: { API_KEY: "legacy" },
    attachments: {
      attachment_models: { image: "legacy" },
      limits: { max_file_size_bytes: 1024 },
      storage: { root: "runtime/attachments" },
    },
    multimodal: {
      parsing: { default_models: { image: "vision" } },
    },
    session: {
      use_last_running_task_range: false,
      use_last_completed_task_range: false,
    },
    tools: {
      set_skill_task: { enabled: true },
      web_to_data: { enabled: true },
      doc_to_data: { enabled: true },
      media_to_data: { enabled: true },
      process_content_task: { enabled: true },
      execute_script: {
        enabled: true,
        sandbox_mode: true,
        sandbox_provider: { default: "docker" },
      },
      read_file: { enabled: true },
    },
  };

  const migrated = migrateConfigFileToCurrentProtocol(config);
  assert.notEqual(migrated, config);
  assert.equal(config.configParams.API_KEY, "legacy");
  assert.deepEqual(migrated, {
    attachments: {
      limits: { max_file_size_bytes: 1024 },
      storage: { root: "runtime/attachments" },
    },
    multimodal: {
      parsing: { default_models: { image: "vision" } },
    },
    tools: {
      execute_script: { enabled: true },
      read_file: { enabled: true },
    },
  });
  assert.deepEqual(migrateConfigFileToCurrentProtocol(migrated), migrated);
  assert.deepEqual(migrated.attachments.limits, { max_file_size_bytes: 1024 });
});

test("current config migration preserves active tool and runtime configuration", () => {
  const config = {
    runTimeoutMs: 120000,
    attachments: {
      maxFileCount: 5,
      allowedExtensions: [".pdf"],
    },
    tools: {
      delegate_task_async: {
        enabled: true,
        waitTimeoutMs: 30000,
        maxSubAgentDepth: 2,
      },
      task_summary: {
        enabled: true,
        phaseSummaryLoopTurns: 10,
      },
      request_help: {
        enabled: true,
        helpPromptLoopTurns: 10,
      },
    },
    plugins: {
      workflow: {
        enabled: false,
        timeoutMs: 18000000,
        maxAutoTransitions: 10,
        maxParallelNodeAgents: 3,
        miniRunnerMaxTurns: 3,
      },
      harness: {
        enabled: true,
        miniRunnerMaxTurns: 5,
      },
    },
  };

  assert.deepEqual(migrateConfigFileToCurrentProtocol(config), config);
});

test("config params document is the only values, descriptions, and catalog authority", () => {
  const document = normalizeConfigParamsDocument({
    values: { api_key: " key ", empty: "  " },
    descriptions: { api_key: " API credential ", region: " Region " },
  });
  assert.deepEqual(document, {
    values: { API_KEY: "key", EMPTY: "" },
    descriptions: { API_KEY: "API credential", REGION: "Region", EMPTY: "" },
  });
  assert.deepEqual(
    buildConfigParamCatalog({
      values: document.values,
      descriptions: document.descriptions,
      extraKeys: ["tenant"],
    }),
    [
      { key: "API_KEY", description: "API credential" },
      { key: "EMPTY", description: "" },
      { key: "REGION", description: "Region" },
      { key: "TENANT", description: "" },
    ],
  );
  assert.deepEqual(
    mergeConfigParamLayers({ API_KEY: "workspace", REGION: "cn" }, { api_key: "user" }),
    { API_KEY: "user", REGION: "cn" },
  );
});

test("config params document rejects ambiguous, invalid, and unknown facts", () => {
  for (const document of [
    { values: [] },
    { descriptions: [] },
    { values: { "API-KEY": "x" } },
    { values: { api_key: "x", API_KEY: "y" } },
    { values: {}, extra: true },
  ]) {
    assert.throws(
      () => normalizeConfigParamsDocument(document),
      (error) => error?.code === CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT,
    );
  }
});

test("config params document keys must be a closed subset of template keys", () => {
  assert.deepEqual(
    assertConfigParamsDocumentKeys(
      {
        values: { api_key: "secret" },
        descriptions: { api_key: "Credential" },
      },
      ["API_KEY", "REGION"],
    ),
    {
      values: { API_KEY: "secret" },
      descriptions: { API_KEY: "Credential" },
    },
  );
  assert.throws(
    () => assertConfigParamsDocumentKeys({ values: { UNUSED_KEY: "value" } }, ["API_KEY"]),
    (error) =>
      error?.code === CONFIG_ERROR_CODE.INVALID_PARAM_DOCUMENT &&
      error?.details?.keys?.[0] === "UNUSED_KEY",
  );
});

test("config params synchronization projects stored values onto authoritative template keys", () => {
  assert.deepEqual(
    synchronizeConfigParamsDocument({
      document: {
        values: { ACTIVE_KEY: "preserved", RETIRED_KEY: "removed" },
        descriptions: { ACTIVE_KEY: "active", RETIRED_KEY: "retired" },
      },
      keys: ["NEW_KEY", "ACTIVE_KEY"],
    }),
    {
      values: { ACTIVE_KEY: "preserved", NEW_KEY: "" },
      descriptions: { ACTIVE_KEY: "active", NEW_KEY: "" },
    },
  );
});

test("template resolution has one explicit source order and unresolved policy", () => {
  const lookup = createConfigValueLookup(
    { API_KEY: "environment" },
    { API_KEY: "params", REGION: "cn" },
  );
  assert.deepEqual(resolveConfigTemplates({ key: "${API_KEY}", region: "${REGION}" }, { lookup }), {
    key: "environment",
    region: "cn",
  });
  assert.equal(
    resolveConfigTemplates("${MISSING}", {
      lookup,
      unresolved: UNRESOLVED_TEMPLATE_POLICY.PRESERVE,
    }),
    "${MISSING}",
  );
  assert.throws(
    () =>
      resolveConfigTemplates("${MISSING}", {
        lookup,
        unresolved: UNRESOLVED_TEMPLATE_POLICY.ERROR,
      }),
    (error) => error?.code === CONFIG_ERROR_CODE.UNRESOLVED_TEMPLATE,
  );
  assert.throws(
    () => resolveConfigTemplates("${MISSING}", { lookup, unresolved: "fallback" }),
    /unsupported unresolved config template policy/,
  );
});

test("config synchronization recursively adds template nodes through one protocol", () => {
  const synchronized = synchronizeConfigFileFromTemplate({
    template: {
      workspace_root: "/template",
      providers: {
        primary: {
          reasoning_effort: "medium",
          tool_reasoning_effort: "medium",
          capabilities: { web_search: true },
        },
        added: { enabled: true },
      },
      tools: {
        execute_script: { enabled: true, sandbox_mode: true },
        read_file: { enabled: true },
        delegate_task_async: { enabled: true, waitTimeoutMs: 30000 },
      },
    },
    target: {
      workspace_root: "/configured",
      providers: { primary: { reasoning_effort: "high" } },
      user_only: true,
    },
    excludedRootKeys: DEPLOYMENT_OWNED_CONFIG_ROOT_KEYS,
  });

  assert.deepEqual(synchronized, {
    workspace_root: "/configured",
    providers: {
      primary: {
        reasoning_effort: "high",
        tool_reasoning_effort: "medium",
        capabilities: { web_search: true },
      },
      added: { enabled: true },
    },
    user_only: true,
    tools: {
      execute_script: { enabled: true },
      read_file: { enabled: true },
      delegate_task_async: { enabled: true, waitTimeoutMs: 30000 },
    },
  });
});

test("build, migration, and validation pipeline exposes one result contract", async () => {
  const input = { nested: { value: 1 } };
  const migrationResult = await applyConfigMigrations({
    config: input,
    migrations: [
      {
        name: "increment",
        migrate: ({ config }) => ({ nested: { value: config.nested.value + 1 } }),
      },
    ],
  });
  assert.deepEqual(input, { nested: { value: 1 } });
  assert.deepEqual(migrationResult, {
    config: { nested: { value: 2 } },
    appliedMigrations: ["increment"],
  });
  assert.deepEqual(
    await validateEffectiveConfig({
      resolvedConfig: migrationResult.config,
      validators: [() => ({ warnings: ["reviewed"] })],
    }),
    ["reviewed"],
  );
  assert.deepEqual(
    createConfigBuildResult({
      rawConfig: input,
      resolvedConfig: migrationResult.config,
      metadata: { migrations: ["increment"], warnings: ["reviewed"] },
    }).metadata,
    { migrations: ["increment"], warnings: ["reviewed"] },
  );
  assert.throws(
    () => createConfigBuildResult({ rawConfig: { configParams: {} }, resolvedConfig: {} }),
    /resolution context/,
  );
});

test("plugin plan and model selection are deterministic protocol projections", () => {
  const plan = createPluginConfigPlan({
    runConfig: {
      selectedPlugins: ["workflow", "harness"],
      disabledPlugins: ["workflow"],
      plugins: { harness: { trace: false } },
    },
    effectiveConfig: { plugins: { harness: { enabled: true, timeoutMs: 1000 } } },
    manifests: [
      { pluginId: "workflow", defaults: { enabled: true } },
      { pluginId: "harness", defaults: { trace: true } },
    ],
  });
  assert.deepEqual(plan.enabledPluginIds, ["harness"]);
  assert.deepEqual(plan.plugins, [
    { pluginId: "harness", options: { trace: false, enabled: true, timeoutMs: 1000 } },
  ]);
  assert.deepEqual(
    selectModelAlias({
      selectedModel: "",
      scenario: "programming",
      effectiveConfig: {
        defaultProvider: "default",
        scenarios: { definitions: { programming: { model: "coder" } } },
      },
    }),
    { alias: "coder", source: "scenario" },
  );
});
