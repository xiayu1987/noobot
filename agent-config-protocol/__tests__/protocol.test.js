/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_NODE_POLICY,
  CONFIG_REPAIR_ACTION,
  CONFIG_PATH_REPRESENTATION,
  listConfigNodePathsByPolicy,
  repairConfigDocument,
  sanitizeUserConfig,
  mergeConfig,
} from "../src/index.js";

function readJsonFixture(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function collectObjectOnlyPaths(source, reference, prefix = "") {
  const paths = [];
  for (const key of Object.keys(source || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(reference || {}, key)) {
      paths.push(path);
      continue;
    }
    const sourceValue = source[key];
    const referenceValue = reference[key];
    if (
      sourceValue &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      referenceValue &&
      typeof referenceValue === "object" &&
      !Array.isArray(referenceValue)
    ) {
      paths.push(...collectObjectOnlyPaths(sourceValue, referenceValue, path));
    }
  }
  return paths;
}
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

test("scenario filtering preserves activated plugin tools and keeps deny authoritative", () => {
  const tools = resolveToolBindings({
    sourceTools: [{ name: "read_file" }, { name: "character_animation_generate" }],
    runConfig: {
      scenario: "programming",
      pluginTools: [{ name: "character_animation_generate" }],
      toolPolicy: { denyToolNames: [] },
    },
  });
  assert.deepEqual(
    tools.map(({ name }) => name),
    ["read_file", "character_animation_generate"],
  );

  const denied = resolveToolBindings({
    sourceTools: [{ name: "character_animation_generate" }],
    runConfig: {
      scenario: "programming",
      pluginTools: [{ name: "character_animation_generate" }],
      toolPolicy: { denyToolNames: ["character_animation_generate"] },
    },
  });
  assert.deepEqual(denied, []);
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
    security: {
      execution_isolation: { mode: "host" },
    },
    tools: {
      set_skill_task: { enabled: true },
      web_to_data: { enabled: true },
      doc_to_data: { enabled: true },
      media_to_data: { enabled: true },
      process_content_task: { enabled: true },
      access_connector: { enabled: true },
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
    security: {
      execution_isolation: { mode: "host" },
    },
    tools: {
      access_connector: { enabled: true },
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

test("config migration does not infer a replacement for an unsupported provider transport", () => {
  const source = {
    providers: {
      qwen: {
        model: "qwen3.5-omni-plus",
        format: "dashscope",
        api_key: "${DASHSCOPE_API_KEY}",
      },
    },
  };
  assert.deepEqual(migrateConfigFileToCurrentProtocol(source), source);
});

test("config migration preserves an explicit DashScope GLM provider", () => {
  const source = {
    providers: {
      glm_5_3: {
        enabled: true,
        used_for_conversation: true,
        api_key: "${DASHSCOPE_API_KEY}",
        base_url: "${DASHSCOPE_API_ADDRESS}",
        model: "ZHIPU/GLM-5.3",
      },
    },
  };
  assert.deepEqual(migrateConfigFileToCurrentProtocol(source), source);
});

test("config repair preserves an explicit DashScope GLM provider over the library default", () => {
  const explicitProvider = {
    enabled: true,
    used_for_conversation: true,
    api_key: "${DASHSCOPE_API_KEY}",
    base_url: "${DASHSCOPE_API_ADDRESS}",
    model: "ZHIPU/GLM-5.3",
    reasoning_effort: "low",
    tool_reasoning_effort: "low",
    reasoning_effort_options: ["low", "high", "max"],
    reasoning_effort_parameter: "reasoning_effort",
  };
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    template: {
      default_provider: "glm_5_3",
      providers: {
        ["glm_5_3"]: {
          ...explicitProvider,
          api_key: "${ZAI_API_KEY}",
          base_url: "${ZAI_API_ADDRESS}",
          model: "glm-5.3",
        },
      },
    },
    target: {
      default_provider: "glm_5_3",
      providers: { ["glm_5_3"]: explicitProvider },
    },
  });
  assert.deepEqual(repaired.document.providers["glm_5_3"], {
    reasoning_effort: "low",
    tool_reasoning_effort: "low",
    reasoning_effort_options: ["low", "high", "max"],
    reasoning_effort_parameter: "reasoning_effort",
    enabled: true,
    used_for_conversation: true,
    api_key: "${DASHSCOPE_API_KEY}",
    base_url: "${DASHSCOPE_API_ADDRESS}",
    model: "ZHIPU/GLM-5.3",
  });
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

test("config params document preserves valid keys outside the current template", () => {
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
  assert.deepEqual(
    assertConfigParamsDocumentKeys({ values: { UNUSED_KEY: "value" } }, ["API_KEY"]),
    { values: { UNUSED_KEY: "value" }, descriptions: { UNUSED_KEY: "" } },
  );
});

test("config params synchronization preserves stored keys and adds template keys", () => {
  assert.deepEqual(
    synchronizeConfigParamsDocument({
      document: {
        values: { ACTIVE_KEY: "preserved", RETIRED_KEY: "removed" },
        descriptions: { ACTIVE_KEY: "active", RETIRED_KEY: "retired" },
      },
      keys: ["NEW_KEY", "ACTIVE_KEY"],
    }),
    {
      values: { ACTIVE_KEY: "preserved", NEW_KEY: "", RETIRED_KEY: "removed" },
      descriptions: { ACTIVE_KEY: "active", NEW_KEY: "", RETIRED_KEY: "retired" },
    },
  );
});

test("template resolution has one explicit source order and unresolved policy", () => {
  const lookup = createConfigValueLookup(
    { API_KEY: "params", REGION: "cn" },
    { API_KEY: "environment" },
  );
  assert.deepEqual(resolveConfigTemplates({ key: "${API_KEY}", region: "${REGION}" }, { lookup }), {
    key: "params",
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

test("config repair preserves a valid custom value and restores an invalid value from its template", () => {
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
    template: { workspace_root: "/template", workspace_template_path: "/template-default" },
    target: { workspace_root: { invalid: true }, workspace_template_path: "/custom-template" },
  });

  assert.equal(repaired.document.workspace_root, "/template");
  assert.equal(repaired.document.workspace_template_path, "/custom-template");
  assert.deepEqual(repaired.report.changes, [
    {
      path: "workspace_root",
      action: CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT,
      reason: "invalid_node_type",
    },
  ]);
});

test("config repair enforces defaulted, optional, and system-owned node policies", () => {
  const template = {
    default_provider: "primary",
    providers: {
      primary: {
        enabled: true,
        used_for_conversation: true,
        model: "primary-model",
        reasoning_effort: "medium",
        tool_reasoning_effort: "medium",
        reasoning_effort_options: ["low", "medium", "high"],
        reasoning_effort_parameter: "reasoning_effort",
      },
    },
    tools: {
      read_file: { enabled: true },
      execute_native_script: { enabled: true },
    },
  };
  const first = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    template,
    target: {
      default_provider: "incomplete",
      providers: {
        primary: {
          enabled: false,
          used_for_conversation: true,
          model: "primary-model",
          temperature: 0.4,
        },
        custom: {
          enabled: true,
          model: "custom-model",
          format: "openai_compatible",
          top_p: 0.8,
          cache_control: false,
        },
        incomplete: { model: "missing-format" },
      },
      tools: {
        read_file: { enabled: "false" },
        execute_native_script: { enabled: false },
      },
      context: { customSection: { enabled: true } },
      session: { executionBundleTimeoutMs: "1000" },
      unknown_root: true,
    },
  });

  assert.equal(CONFIG_NODE_POLICY.USER_CONFIGURABLE, "user_configurable");
  assert.equal(CONFIG_NODE_POLICY.USER_OPTIONAL, "user_optional");
  assert.equal(CONFIG_NODE_POLICY.GLOBAL_ONLY, "global_only");
  assert.equal(first.document.tools.read_file.enabled, true);
  assert.equal(first.document.tools.execute_native_script.enabled, false);
  assert.equal(first.document.providers.primary.temperature, 0.4);
  assert.equal(first.document.providers.primary.enabled, false);
  assert.equal(first.document.providers.custom.top_p, 0.8);
  assert.equal(first.document.providers.custom.cache_control, false);
  assert.equal(first.document.providers.incomplete.model, "missing-format");
  assert.equal("format" in first.document.providers.incomplete, false);
  assert.equal(first.document.default_provider, "incomplete");
  assert.deepEqual(first.document.context, { customSection: { enabled: true } });
  assert.deepEqual(first.document.session, {});
  assert.equal(first.document.unknown_root, undefined);
  assert.equal(
    first.report.changes.some(({ path }) => path === "tools.execute_native_script"),
    false,
  );
  assert.equal(JSON.stringify(first.report).includes("custom-model"), false);

  const unsupportedFormat = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    template,
    target: {
      ...template,
      providers: {
        ...template.providers,
        removed: { model: "qwen", format: "dashscope" },
      },
    },
  });
  assert.equal(unsupportedFormat.document.providers.removed.model, "qwen");
  assert.equal("format" in unsupportedFormat.document.providers.removed, false);

  const repairedKnownLegacy = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    template,
    target: {
      ...template,
      providers: {
        ...template.providers,
        gpt_5_4: {
          enabled: true,
          model: "gpt-5.4",
          format: "unsupported_transport",
          api_key: "${CUSTOM_KEY}",
        },
      },
    },
  });
  assert.ok(repairedKnownLegacy.document.providers.gpt_5_4);
  assert.equal("format" in repairedKnownLegacy.document.providers.gpt_5_4, false);
  assert.equal(repairedKnownLegacy.document.providers.gpt_5_4.api_key, "${CUSTOM_KEY}");

  const second = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    template,
    target: first.document,
  });
  assert.equal(second.report.changed, false);
  assert.deepEqual(second.document, first.document);
});

test("global repair preserves supported optional runtime nodes without adding missing ones", () => {
  const template = { preferences: { language: "zh-CN" } };
  const missing = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
    template,
    target: template,
  });
  assert.equal(missing.document.memory, undefined);
  assert.equal(missing.report.changed, false);

  const configured = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
    template,
    target: {
      ...template,
      memory: { summarizeTimeoutMs: 5000, postprocess_async: false },
      session: { executionBundleTimeoutMs: 3000 },
    },
  });
  assert.deepEqual(configured.document.memory, {
    summarizeTimeoutMs: 5000,
    postprocess_async: false,
  });
  assert.deepEqual(configured.document.session, { executionBundleTimeoutMs: 3000 });
  assert.equal(configured.report.changed, false);
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
