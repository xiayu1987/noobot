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

async function createFixture() {
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
        execution_isolation: {
          mode: "sandbox",
          sandbox: { provider: "docker", scope: "user" },
        },
      },
      providers: {
        openai: { model: "gpt", enabled: true, used_for_conversation: true },
        selected: { model: "selected-model", enabled: false, used_for_conversation: false },
      },
      default_provider: "openai",
      multimodal: {
        parsing: { default_models: { audio: "openai", image: "openai" } },
        generation: { default_models: { image: "openai" } },
      },
    }),
  );
  await writeFile(
    path.join(packagedBackendRoot, "user-template", "default-user", "config.example.json"),
    JSON.stringify({
      default_provider: "openai",
      providers: {
        openai: { model: "gpt", enabled: true, used_for_conversation: true },
        selected: { model: "selected-model", enabled: false, used_for_conversation: false },
      },
      multimodal: {
        parsing: { default_models: { audio: "openai", image: "openai" } },
        generation: { default_models: { image: "openai" } },
      },
    }),
  );
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "memory"), {
    recursive: true,
  });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "runtime"), {
    recursive: true,
  });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "services"), {
    recursive: true,
  });
  await mkdir(path.join(packagedBackendRoot, "user-template", "default-user", "skills"), {
    recursive: true,
  });
  await writeFile(
    path.join(packagedBackendRoot, "user-template", "default-user", "memory", "short-memory.json"),
    "{}",
  );
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

    manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath });

    const config = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(config.newly_added_config.nested.default_value, true);
    assert.equal(config.newly_added_config.nested.preserved_value, "client");
    assert.equal(config.security.execution_isolation.mode, "host");
    assert.equal(config.security.path_policy, undefined);
    assert.equal(Object.hasOwn(config.attachments, "attachment_models"), false);
    assert.equal(config.attachments.limits.max_file_size_bytes, 2048);
    assert.deepEqual(config.multimodal.parsing.default_models, {
      audio: "openai",
      image: "openai",
    });
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

test("packaged desktop config restores missing userData template example before saving super admin", async () => {
  const fixture = await createFixture();
  const logs = [];
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
      appendDesktopLog: (line) => logs.push(line),
    });

    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    const templateExample = path.join(
      fixture.userDataPath,
      "user-template",
      "default-user",
      "config.example.json",
    );
    assert.equal(state.workspaceTemplatePath, path.dirname(templateExample));
    assert.equal(state.templateConfigPath, path.join(path.dirname(templateExample), "config.json"));
    assert.equal(JSON.parse(await readFile(templateExample, "utf8")).default_provider, "openai");

    await rm(templateExample, { force: true });
    const restoredState = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    assert.equal(JSON.parse(await readFile(templateExample, "utf8")).default_provider, "openai");
    manager.saveSuperAdminConfig({
      globalConfigPath: restoredState.globalConfigPath,
      userConfigPath: restoredState.templateConfigPath,
      userId: "owner",
      connectCode: "secret",
      language: "en-US",
      model: "selected",
    });

    const globalConfig = JSON.parse(await readFile(restoredState.globalConfigPath, "utf8"));
    const templateConfig = JSON.parse(await readFile(restoredState.templateConfigPath, "utf8"));
    assert.equal(globalConfig.super_admin.user_id, "owner");
    assert.equal(globalConfig.super_admin.connect_code, "secret");
    assert.equal(globalConfig.security.execution_isolation.mode, "host");
    assert.equal(templateConfig.default_provider, "selected");
    assert.deepEqual(globalConfig.multimodal.parsing.default_models, {
      audio: "selected",
      image: "selected",
    });
    assert.equal(globalConfig.multimodal.generation.default_models.image, "selected");
    assert.equal(templateConfig.multimodal.parsing.default_models.audio, "selected");
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop setup selects library models and inserts missing providers into both configs", async () => {
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
      userConfigPath: state.templateConfigPath,
      userId: "owner",
      connectCode: "secret",
      language: "en-US",
      model: "gemini_3_7_flash",
    });

    const nextState = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    const globalConfig = JSON.parse(await readFile(state.globalConfigPath, "utf8"));
    const defaultUserConfig = JSON.parse(await readFile(state.templateConfigPath, "utf8"));
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
    for (const filePath of [state.globalConfigPath, state.templateConfigPath]) {
      const config = JSON.parse(await readFile(filePath, "utf8"));
      config.providers.selected.reasoning_effort = "medium";
      config.providers.selected.tool_reasoning_effort = "medium";
      await writeFile(filePath, JSON.stringify(config));
    }

    manager.saveSuperAdminConfig({
      globalConfigPath: state.globalConfigPath,
      userConfigPath: state.templateConfigPath,
      userId: "owner",
      connectCode: "secret",
      language: "en-US",
      model: "selected",
    });

    for (const filePath of [state.globalConfigPath, state.templateConfigPath]) {
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
    await writeFile(
      path.join(existingUserPath, "config.example.json"),
      JSON.stringify(retiredConfig),
    );

    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });

    for (const fileName of ["config.json", "config.example.json"]) {
      const config = JSON.parse(await readFile(path.join(existingUserPath, fileName), "utf8"));
      assert.equal(Object.hasOwn(config, "attachments"), false);
      assert.equal(Object.hasOwn(config, "session"), false);
      assert.deepEqual(config.tools, {
        access_connector: { enabled: true },
        execute_script: { enabled: true },
        read_file: { enabled: true },
      });
    }
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop startup removes config params absent from current templates", async () => {
  const fixture = await createFixture();
  try {
    const globalExamplePath = path.join(
      fixture.packagedBackendRoot,
      "service",
      "config",
      "global.config.example.json",
    );
    const globalExample = JSON.parse(await readFile(globalExamplePath, "utf8"));
    globalExample.providers.openai.api_key = "${ACTIVE_API_KEY}";
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
      values: { ACTIVE_API_KEY: "preserved" },
      descriptions: { ACTIVE_API_KEY: "active" },
    });
    const globalConfig = JSON.parse(await readFile(globalConfigPath, "utf8"));
    assert.equal(globalConfig.tools, undefined);
    assert.deepEqual(state.missingParams, []);
    assert.throws(
      () =>
        manager.saveConfigParamValues({
          workspaceRootPath: state.workspaceRootPath,
          values: { RETIRED_API_KEY: "must-not-return" },
        }),
      /unknown config param key: RETIRED_API_KEY/,
    );
    assert.deepEqual(JSON.parse(await readFile(configParamsPath, "utf8")).values, {
      ACTIVE_API_KEY: "preserved",
    });
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop config fails fast when bundled default user template is missing", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    await rm(path.join(fixture.packagedBackendRoot, "user-template"), {
      recursive: true,
      force: true,
    });

    assert.throws(
      () =>
        manager.ensureDesktopGlobalConfig({ isPackaged: true, userDataPath: fixture.userDataPath }),
      /desktop bundled default user config example is missing or invalid:/,
    );
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop config replaces corrupted userData template example from bundled runtime", async () => {
  const fixture = await createFixture();
  try {
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
    });
    const templateDir = path.join(fixture.userDataPath, "user-template", "default-user");
    const templateExample = path.join(templateDir, "config.example.json");
    await mkdir(templateDir, { recursive: true });
    await writeFile(templateExample, "{broken", "utf8");

    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    assert.equal(state.workspaceTemplatePath, templateDir);
    assert.equal(JSON.parse(await readFile(templateExample, "utf8")).default_provider, "openai");
  } finally {
    await fixture.restore();
  }
});

test("packaged desktop config restores core template even when directory sync fails", async () => {
  const fixture = await createFixture();
  const originalCpSync = fs.cpSync;
  try {
    const logs = [];
    const manager = createDesktopConfigManager({
      repoRoot: fixture.repoRoot,
      packagedBackendRoot: fixture.packagedBackendRoot,
      appendDesktopLog: (line) => logs.push(line),
    });
    fs.cpSync = () => {
      throw new Error("directory copy blocked");
    };

    const state = manager.ensureDesktopGlobalConfig({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
    });
    const templateExample = path.join(
      fixture.userDataPath,
      "user-template",
      "default-user",
      "config.example.json",
    );
    assert.equal(state.workspaceTemplatePath, path.dirname(templateExample));
    assert.equal(JSON.parse(await readFile(templateExample, "utf8")).default_provider, "openai");
    assert.equal(
      await readFile(
        path.join(
          fixture.userDataPath,
          "user-template",
          "default-user",
          "memory",
          "short-memory.json",
        ),
        "utf8",
      ),
      "{}",
    );
    assert.match(
      await readFile(
        path.join(
          fixture.userDataPath,
          "user-template",
          "default-user",
          "services",
          "weather-service-handler.js",
        ),
        "utf8",
      ),
      /export default/,
    );
    assert.match(
      await readFile(
        path.join(fixture.userDataPath, "user-template", "default-user", "skills", "SKILL.md"),
        "utf8",
      ),
      /Skill/,
    );
    assert.ok(logs.some((line) => line.includes("desktop template directory sync failed")));
    assert.ok(logs.some((line) => line.includes("manual fallback")));
  } finally {
    fs.cpSync = originalCpSync;
    await fixture.restore();
  }
});
