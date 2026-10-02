/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { clientFilePath as path } from "../../path-resolver.js";
import test from "node:test";
import { createDesktopConfigManager } from "../../electron/runtime/config.js";

export async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noobot-desktop-config-"));
  const repoRoot = path.join(rootDir, "repo");
  const packagedBackendRoot = path.join(rootDir, "resources", "backend");
  const userDataPath = path.join(rootDir, "user-data");
  await mkdir(path.join(packagedBackendRoot, "service", "config"), { recursive: true });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user"), { recursive: true });
  await writeFile(
    path.join(packagedBackendRoot, "service", "config", "global.config.example.json"),
    JSON.stringify({
      workspace_root: "../workspace",
      workspace_template_path: "../user-template/default-user",
      super_admin: {
        user_id: "admin",
        connect_code: "change-your-connect-code",
      },
      preferences: { language: "zh-CN" },
      newly_added_config: {
        nested: {
          default_value: true,
          preserved_value: "template",
        },
      },
      security: {
        trusted_directories: ["*"],
        execution_isolation: {
          mode: "sandbox",
          sandbox: { provider: "docker", scope: "user", mounts: [] },
        },
      },
      tools: {
        access_connector: { enabled: true },
        execute_script: { enabled: true },
        read_file: { enabled: true },
      },
      providers: {
        openai: {
          model: "gpt",
          reasoning_effort_options: ["low", "medium", "high"],
          reasoning_effort_parameter: "reasoning_effort",
          enabled: true,
          used_for_conversation: true,
          multimodal_parsing: {
            enabled: true,
            input_modalities: ["audio", "image"],
          },
          multimodal_generation: {
            support_generation: {
              enabled: true,
              support_scope: ["image"],
              api_type: "openai_responses",
            },
          },
        },
        selected: {
          model: "selected-model",
          reasoning_effort_options: ["low", "medium", "high"],
          reasoning_effort_parameter: "reasoning_effort",
          enabled: false,
          used_for_conversation: false,
          reasoning_effort: "high",
          tool_reasoning_effort: "high",
        },
      },
      default_provider: "openai",
      multimodal: {
        parsing: { default_models: { audio: "openai", image: "openai" } },
        generation: { default_models: { image: "openai" } },
      },
      plugins: {
        character: {
          enabled: true,
          mode: "on",
          selectedCharacterAssetIds: [],
        },
      },
    }),
  );
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "services"), {
    recursive: true,
  });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "skills"), {
    recursive: true,
  });
  await writeFile(
    path.join(
      packagedBackendRoot,
      "user-template",
      "default-user",
      "services",
      "weather-service-handler.js",
    ),
    "export default {};\n",
  );
  await writeFile(
    path.join(packagedBackendRoot, "user-template", "default-user", "skills", "SKILL.md"),
    "# Skill\n",
  );
  return {
    rootDir,
    repoRoot,
    packagedBackendRoot,
    userDataPath,
    restore: () => rm(rootDir, { recursive: true, force: true }),
  };
}

test("packaged desktop startup incrementally adds any bundled global config fields", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const configDir = path.join(fixture.userDataPath, "config");
    const globalConfigPath = path.join(configDir, "global.config.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        newly_added_config: { nested: { preserved_value: "client" } },
        attachments: {
          attachment_models: { image: "legacy" },
          limits: { max_file_size_bytes: 2048 },
        },
      }),
    );
    const legacyUserDir = path.join(fixture.userDataPath, "workspace", "admin");
    await mkdir(legacyUserDir, { recursive: true });
    await writeFile(path.join(legacyUserDir, "config.json"), JSON.stringify({ providers: {} }));

    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });

    const config = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(config.newly_added_config, undefined);
    assert.deepEqual(config.security.trusted_directories, ["*"]);
    assert.equal(config.security.execution_isolation.mode, "host");
    assert.equal(config.security.path_policy, undefined);
    assert.deepEqual(config.attachments, {
      limits: { max_file_size_bytes: 2048 },
    });
    assert.deepEqual(config.multimodal.parsing.default_models, {
      audio: "openai",
      image: "openai",
    });
    const userConfig = JSON.parse(await readFile(path.join(legacyUserDir, "config.json"), "utf8"));
    assert.deepEqual(userConfig.plugins.character, { enabled: true, mode: "on" });
    assert.equal(fs.existsSync(path.join(legacyUserDir, "config.example.json")), false);
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop config preserves an explicitly selected sandbox and its mounts", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const configDir = path.join(fixture.userDataPath, "config");
    const globalConfigPath = path.join(configDir, "global.config.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        security: {
          execution_isolation: {
            mode: "sandbox",
            sandbox: {
              mounts: [
                {
                  source: "C:\\Users\\owner\\project",
                  target: "/custom-project",
                  read_only: true,
                },
              ],
            },
          },
        },
      }),
    );

    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });

    const config = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(config.security.execution_isolation.mode, "sandbox");
    assert.deepEqual(config.security.execution_isolation.sandbox.mounts, [
      {
        source: "C:\\Users\\owner\\project",
        target: "/custom-project",
        read_only: true,
      },
    ]);
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop defaults to host once and never overrides a later isolation selection", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const globalConfigPath = path.join(fixture.userDataPath, "config", "global.config.json");

    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });
    const firstConfig = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(firstConfig.security.execution_isolation.mode, "host");

    firstConfig.security.execution_isolation = {
      mode: "sandbox",
      sandbox: {
        scope: "global",
        mounts: [{ source: "/host/project", target: "/project" }],
      },
    };
    await writeFile(globalConfigPath, JSON.stringify(firstConfig));

    const examplePath = path.join(
      fixture.packagedBackendRoot,
      "service",
      "config",
      "global.config.example.json",
    );
    const nextExample = JSON.parse(await readFile(examplePath, "utf8"));
    nextExample.security.execution_isolation.sandbox.lock_wait_timeout_ms = 120000;
    await writeFile(examplePath, JSON.stringify(nextExample));

    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });
    const restartedConfig = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(restartedConfig.security.execution_isolation.mode, "sandbox");
    assert.equal(restartedConfig.security.execution_isolation.sandbox.scope, "global");
    assert.deepEqual(restartedConfig.security.execution_isolation.sandbox.mounts, [
      { source: "/host/project", target: "/project" },
    ]);
    assert.equal(restartedConfig.security.execution_isolation.sandbox.lock_wait_timeout_ms, 120000);
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop setup selects library models and new users inherit them from the global config", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    assert.equal(
      state.superAdmin.modelOptions.some((item) => item.key === "gemini_3_7_flash"),
      true,
    );
    assert.equal(
      state.superAdmin.modelOptions.some((item) => item.key === "openai" && !item.library),
      true,
    );

    manager.saveSuperAdminConfig({
      globalConfigPath: state.globalConfigPath,
      userId: "owner",
      connectCode: "secret",
      language: "en-US",
      model: "gemini_3_7_flash",
    });
    const newUserConfigPath = path.join(state.workspaceRootPath, "owner", "config.json");
    await mkdir(path.dirname(newUserConfigPath), { recursive: true });
    await writeFile(newUserConfigPath, "{}");

    const nextState = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    const globalConfig = JSON.parse(await readFile(state.globalConfigPath, "utf8"));
    const defaultUserConfig = JSON.parse(await readFile(newUserConfigPath, "utf8"));
    for (const config of [globalConfig, defaultUserConfig]) {
      assert.equal(config.default_provider, "gemini_3_7_flash");
      assert.equal(config.providers["gemini_3_7_flash"].model, "gemini-3.7-flash");
      assert.equal(config.providers["gemini_3_7_flash"].api_key, "${GEMINI_API_KEY}");
    }
    assert.equal(globalConfig.providers.openai.model, "gpt");
    assert.equal(defaultUserConfig.providers.openai.model, "gpt");
    assert.equal(
      nextState.missingParams.some((item) => item.key === "GEMINI_API_KEY"),
      true,
    );
    assert.equal(
      nextState.missingParams.some((item) => item.key === "GEMINI_API_ADDRESS"),
      true,
    );
    assert.deepEqual(
      nextState.missingParams.slice(0, 2).map(({ key, group, modelField }) => ({
        key,
        group,
        modelField,
      })),
      [
        { key: "GEMINI_API_KEY", group: "model", modelField: "api_key" },
        { key: "GEMINI_API_ADDRESS", group: "model", modelField: "base_url" },
      ],
    );
    assert.equal(
      nextState.missingParams
        .slice(2)
        .every((item) => item.group === "general" && item.modelField === ""),
      true,
    );
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop model selection preserves explicit provider reasoning settings", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    const userConfigPath = path.join(state.workspaceRootPath, "owner", "config.json");
    await mkdir(path.dirname(userConfigPath), { recursive: true });
    await writeFile(userConfigPath, "{}");
    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });
    for (const filePath of [state.globalConfigPath, userConfigPath]) {
      const config = JSON.parse(await readFile(filePath, "utf8"));
      config.providers.selected.reasoning_effort = "medium";
      config.providers.selected.tool_reasoning_effort = "medium";
      await writeFile(filePath, JSON.stringify(config));
    }

    manager.saveSuperAdminConfig({
      globalConfigPath: state.globalConfigPath,
      userId: "owner",
      connectCode: "secret",
      language: "en-US",
      model: "selected",
    });
    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });

    for (const filePath of [state.globalConfigPath, userConfigPath]) {
      const config = JSON.parse(await readFile(filePath, "utf8"));
      assert.equal(config.providers.selected.reasoning_effort, "medium");
      assert.equal(config.providers.selected.tool_reasoning_effort, "medium");
    }
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop startup removes retired nodes from existing user configs", async () => {
  const fixture = await createFixture();
  try {
    const existingUserPath = path.join(fixture.userDataPath, "workspace", "existing-user");
    await mkdir(existingUserPath, { recursive: true });
    const retiredConfig = {
      attachments: { attachment_models: { image: "old" } },
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
        database_connect_connector: {
          enabled: true,
          connectors: { example_database: { password: "${EXAMPLE_DATABASE_PASSWORD}" } },
        },
        terminal_connect_connector: {
          enabled: true,
          connectors: { example_terminal: { password: "${EXAMPLE_TERMINAL_PASSWORD}" } },
        },
        email_connect_connector: {
          enabled: true,
          connectors: { example_email: { password: "${EMAIL_AUTH_CODE}" } },
        },
        process_connector_tool: { enabled: true },
        inspect_connectors: { enabled: true },
        access_connector: {
          enabled: true,
          command_file: { enabled: true, allowed_roots: [] },
        },
        execute_script: {
          enabled: true,
          sandbox_mode: true,
          sandbox_provider: { default: "docker" },
        },
        read_file: { enabled: true },
      },
    };
    await writeFile(path.join(existingUserPath, "config.json"), JSON.stringify(retiredConfig));

    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });

    const config = JSON.parse(await readFile(path.join(existingUserPath, "config.json"), "utf8"));
    assert.equal(Object.hasOwn(config, "attachments"), false);
    assert.equal(Object.hasOwn(config, "session"), false);
    assert.deepEqual(config.tools, {
      access_connector: { enabled: true },
      read_file: { enabled: true },
    });
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop startup preserves config params absent from current templates", async () => {
  const fixture = await createFixture();
  try {
    const globalExamplePath = path.join(
      fixture.packagedBackendRoot,
      "service",
      "config",
      "global.config.example.json",
    );
    const globalExample = JSON.parse(await readFile(globalExamplePath, "utf8"));
    for (const provider of Object.values(globalExample.providers)) {
      provider.api_key = "${ACTIVE_API_KEY}";
      provider.base_url = "https://models.example.invalid/v1";
    }
    await writeFile(globalExamplePath, JSON.stringify(globalExample));

    const configParamsPath = path.join(fixture.userDataPath, "workspace", "config-params.json");
    const globalConfigPath = path.join(fixture.userDataPath, "config", "global.config.json");
    await mkdir(path.dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        tools: {
          database_connect_connector: {
            enabled: true,
            connectors: { example_database: { password: "${RETIRED_API_KEY}" } },
          },
        },
      }),
    );
    await mkdir(path.dirname(configParamsPath), { recursive: true });
    await writeFile(
      configParamsPath,
      JSON.stringify({
        values: { ACTIVE_API_KEY: "preserved", RETIRED_API_KEY: "stale" },
        descriptions: { ACTIVE_API_KEY: "active", RETIRED_API_KEY: "retired" },
      }),
    );

    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });

    assert.deepEqual(JSON.parse(await readFile(configParamsPath, "utf8")), {
      values: { ACTIVE_API_KEY: "preserved", RETIRED_API_KEY: "stale" },
      descriptions: { ACTIVE_API_KEY: "active", RETIRED_API_KEY: "retired" },
    });
    const globalConfig = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.deepEqual(globalConfig.tools, {
      access_connector: { enabled: true },
      execute_script: { enabled: true },
      read_file: { enabled: true },
    });
    assert.deepEqual(state.missingParams, []);
    manager.saveConfigParamValues({
      workspaceRootPath: state.workspaceRootPath,
      values: { RETIRED_API_KEY: "user-defined" },
    });
    assert.deepEqual(JSON.parse(await readFile(configParamsPath, "utf8")).values, {
      ACTIVE_API_KEY: "preserved",
      RETIRED_API_KEY: "user-defined",
    });
    manager.saveConfigParamValues({
      workspaceRootPath: state.workspaceRootPath,
      values: { ACTIVE_API_KEY: "updated" },
    });
    assert.deepEqual(JSON.parse(await readFile(configParamsPath, "utf8")).values, {
      ACTIVE_API_KEY: "updated",
      RETIRED_API_KEY: "user-defined",
    });
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop points the workspace asset package at the bundled template without copying it", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    assert.equal(
      state.workspaceTemplatePath,
      path.join(fixture.packagedBackendRoot, "user-template", "default-user"),
    );
    assert.equal(fs.existsSync(path.join(fixture.userDataPath, "user-template")), false);
    assert.equal(Object.hasOwn(state, "templateConfigPath"), false);
  } finally {
    await fixture.restore();
  }
});
