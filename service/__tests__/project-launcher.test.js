/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { resolveEnvNamesByFormat } from "../scripts/project-launcher/provider.js";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const launcherPath = path.resolve(testDir, "../scripts/project-launcher.js");

test("project launcher maps model families to their provider credentials", () => {
  assert.deepEqual(resolveEnvNamesByFormat("openai_compatible", "qwen3.7-max"), {
    apiKeyEnv: "DASHSCOPE_API_KEY",
    baseUrlEnv: "DASHSCOPE_API_ADDRESS",
  });
  assert.deepEqual(resolveEnvNamesByFormat("openai_compatible", "kimi-k3"), {
    apiKeyEnv: "MOONSHOT_API_KEY",
    baseUrlEnv: "MOONSHOT_API_ADDRESS",
  });
  assert.deepEqual(resolveEnvNamesByFormat("openai_compatible", "glm-5.3"), {
    apiKeyEnv: "ZAI_API_KEY",
    baseUrlEnv: "ZAI_API_ADDRESS",
  });
  assert.deepEqual(resolveEnvNamesByFormat("openai_compatible", "gemini-3.7-flash"), {
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrlEnv: "GEMINI_API_ADDRESS",
  });
  assert.deepEqual(resolveEnvNamesByFormat("openai_compatible", "deepseek-v4"), {
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_API_ADDRESS",
  });
  assert.deepEqual(resolveEnvNamesByFormat("openai_compatible", "grok-4.6"), {
    apiKeyEnv: "XAI_API_KEY",
    baseUrlEnv: "XAI_API_ADDRESS",
  });
});

const minimalGlobalExample = {
  workspace_root: "../workspace",
  workspace_template_path: "../user-template/default-user",
  preferences: {
    language: "zh-CN",
  },
  tools: {
    web_search: {
      search_engine: {
        endpoints: {
          search: {
            url: "${WEB_SEARCH_ENGINE_SEARCH_ADDRESS}",
          },
        },
      },
    },
  },
  providers: {
    example_openai: {
      enabled: true,
      used_for_conversation: true,
      api_key: "${OPENAI_API_KEY}",
      base_url: "${OPENAI_API_ADDRESS}",
      model: "example-openai",
      format: "openai_compatible",
    },
  },
};

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function makeServiceRoot() {
  const serviceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-project-launcher-"));
  await writeJson(
    path.join(serviceRoot, "config", "global.config.example.json"),
    minimalGlobalExample,
  );
  return serviceRoot;
}

async function runLauncher(serviceRoot, { env = {}, args = [] } = {}) {
  return execFileAsync(process.execPath, [launcherPath, ...args], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      AGENT_GLOBAL_CONFIG_PATH: "",
      NOOBOT_GLOBAL_CONFIG_PATH: "",
      NOOBOT_SETUP_LANG: "en",
      ...env,
    },
  });
}

test("project launcher uses NOOBOT_GLOBAL_CONFIG_PATH when resolving global config", async (t) => {
  const serviceRoot = await makeServiceRoot();
  t.after(() => rm(serviceRoot, { recursive: true, force: true }));
  const customConfigPath = path.join(serviceRoot, "custom-config", "global.config.json");
  await writeJson(customConfigPath, {
    workspace_root: "./custom-workspace",
    workspace_template_path: "./custom-template",
    preferences: {
      language: "en-US",
    },
  });
  await writeJson(path.join(serviceRoot, "custom-template", "config.example.json"), {
    preferences: {
      language: "en-US",
    },
  });

  await runLauncher(serviceRoot, {
    env: {
      NOOBOT_GLOBAL_CONFIG_PATH: customConfigPath,
    },
  });

  const customConfig = await readJson(customConfigPath);
  assert.equal(customConfig.workspace_root, "./custom-workspace");
  assert.equal(customConfig.workspace_template_path, "./custom-template");
  assert.ok(customConfig.providers?.example_openai);
  assert.equal(await exists(path.join(serviceRoot, "config", "global.config.json")), false);
  assert.equal(
    await exists(path.join(serviceRoot, "custom-workspace", "config-params.json")),
    true,
  );
});

test("project launcher initializes a known provider from the model library", async (t) => {
  const serviceRoot = await makeServiceRoot();
  t.after(() => rm(serviceRoot, { recursive: true, force: true }));

  await runLauncher(serviceRoot, {
    env: {
      NOOBOT_MODEL_FORMAT: "openai_compatible",
      NOOBOT_MODEL_NAME: "gpt-5.4",
      NOOBOT_MODEL_API_KEY: "test-key",
      NOOBOT_MODEL_BASE_URL: "https://example.invalid/v1",
    },
  });

  const globalConfig = await readJson(path.join(serviceRoot, "config", "global.config.json"));
  assert.equal(globalConfig.providers?.["gpt_5_4"]?.reasoning_effort, "medium");
  assert.equal(globalConfig.providers?.["gpt_5_4"]?.tool_reasoning_effort, "medium");
});

test("project launcher preserves explicit provider reasoning settings during incremental sync", async (t) => {
  const serviceRoot = await makeServiceRoot();
  t.after(() => rm(serviceRoot, { recursive: true, force: true }));
  const globalConfigPath = path.join(serviceRoot, "config", "global.config.json");
  const templatePath = path.join(serviceRoot, "workspace-template", "config.example.json");
  await writeJson(globalConfigPath, {
    workspace_root: "./workspace",
    workspace_template_path: "./workspace-template",
    super_admin: { user_id: "owner" },
    preferences: { language: "zh-CN" },
    providers: {
      selected_model: {
        enabled: true,
        used_for_conversation: true,
        format: "openai_compatible",
        model: "gpt-5.5",
        reasoning_effort: "medium",
        tool_reasoning_effort: "medium",
      },
    },
  });
  await writeJson(templatePath, { preferences: { language: "zh-CN" } });

  await runLauncher(serviceRoot);

  const globalConfig = await readJson(globalConfigPath);
  assert.equal(globalConfig.providers.selected_model.reasoning_effort, "medium");
  assert.equal(globalConfig.providers.selected_model.tool_reasoning_effort, "medium");
});

test("project launcher resolves camelCase workspace config keys for existing configs", async (t) => {
  const serviceRoot = await makeServiceRoot();
  t.after(() => rm(serviceRoot, { recursive: true, force: true }));
  await writeJson(path.join(serviceRoot, "config", "global.config.json"), {
    workspaceRoot: "./camel-workspace",
    workspaceTemplatePath: "./camel-template",
    superAdmin: {
      userId: "root-admin",
    },
    preferences: {
      language: "zh-CN",
    },
  });
  await writeJson(path.join(serviceRoot, "camel-template", "config.example.json"), {
    preferences: {
      language: "zh-CN",
    },
  });

  await runLauncher(serviceRoot);

  assert.equal(await exists(path.join(serviceRoot, "camel-workspace", "config-params.json")), true);
  assert.equal(await exists(path.join(serviceRoot, "workspace", "config-params.json")), false);
});

test("project launcher recursively adds new global nodes without replacing configured values", async (t) => {
  const serviceRoot = await makeServiceRoot();
  t.after(() => rm(serviceRoot, { recursive: true, force: true }));
  const examplePath = path.join(serviceRoot, "config", "global.config.example.json");
  const example = await readJson(examplePath);
  example.security = {
    execution_isolation: {
      mode: "sandbox",
      sandbox: {
        provider: "docker",
        scope: "user",
        image: "example/default-image",
        mounts: [],
      },
    },
  };
  example.super_admin = {
    user_id: "admin",
    connect_code: "change-your-connect-code",
  };
  example.streaming = { enabled: true, transport: "sse" };
  example.tools.execute_script = { enabled: true };
  example.multimodal = {
    parsing: {
      default_models: {
        audio: "example_openai",
        video: "example_openai",
        image: "example_openai",
        document: "example_openai",
      },
    },
    generation: { default_models: { image: "example_openai" } },
  };
  await writeJson(examplePath, example);
  await writeJson(path.join(serviceRoot, "default-template", "config.example.json"), {});
  await writeJson(path.join(serviceRoot, "config", "global.config.json"), {
    workspace_root: "./workspace",
    workspace_template_path: "./default-template",
    preferences: { language: "en-US" },
    security: {
      execution_isolation: {
        mode: "host",
        sandbox: {
          scope: "global",
          mounts: [{ source: "/srv/custom", target: "/custom" }],
        },
      },
    },
    super_admin: {
      user_id: "owner",
      connect_code: "configured-secret",
    },
    attachments: {
      attachment_models: { image: "legacy" },
      limits: { max_file_size_bytes: 4096 },
    },
    session: {
      use_last_running_task_range: false,
      use_last_completed_task_range: false,
    },
    tools: {
      set_skill_task: { enabled: true },
      execute_script: {
        enabled: true,
        sandbox_mode: true,
        sandbox_provider: { default: "docker" },
      },
    },
    streaming: { enabled: false },
  });

  await runLauncher(serviceRoot);

  const config = await readJson(path.join(serviceRoot, "config", "global.config.json"));
  assert.equal(config.security.execution_isolation.mode, "host");
  assert.equal(config.security.execution_isolation.sandbox.scope, "global");
  assert.deepEqual(config.security.execution_isolation.sandbox.mounts, [
    { source: "/srv/custom", target: "/custom" },
  ]);
  assert.equal(config.security.execution_isolation.sandbox.provider, "docker");
  assert.equal(config.security.execution_isolation.sandbox.image, "example/default-image");
  assert.equal(config.super_admin.user_id, "owner");
  assert.equal(config.super_admin.connect_code, "configured-secret");
  assert.equal(config.streaming.enabled, false);
  assert.equal(config.streaming.transport, "sse");
  assert.equal(config.attachments, undefined);
  assert.equal(Object.hasOwn(config, "session"), false);
  assert.equal(Object.hasOwn(config.tools, "set_skill_task"), false);
  assert.deepEqual(config.tools.execute_script, { enabled: true });
  assert.equal(config.multimodal.parsing.default_models.document, "example_openai");
  assert.equal(config.multimodal.generation.default_models.image, "example_openai");
});
