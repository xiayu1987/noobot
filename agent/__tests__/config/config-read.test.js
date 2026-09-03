/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { loadGlobalConfig } from "../../src/config/core/global-config-loader.js";
import { ConfigService } from "../../src/config/core/config-service.js";

async function createTempDir(prefix = "noobot-config-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("loadGlobalConfig: 应读取并规范化 snake_case 配置键", async () => {
  const tempDir = await createTempDir();
  const filePath = path.join(tempDir, "global.config.json");
  try {
    await writeFile(
      filePath,
      JSON.stringify({
        workspace_root: "/tmp/workspace",
        default_provider: "openai",
        runTimeoutMs: 12345,
        mcp_servers: {
          local_server: {
            keep_snake_key: true,
          },
        },
      }),
      "utf8",
    );

    const loaded = await loadGlobalConfig(filePath);
    assert.equal(loaded.workspaceRoot, "/tmp/workspace");
    assert.equal(loaded.defaultProvider, "openai");
    assert.equal(loaded.runTimeoutMs, 12345);
    assert.ok(loaded.mcpServers?.local_server, "mcp_servers 顶层应被规范化为 mcpServers");
    assert.equal(
      loaded.mcpServers.local_server.keep_snake_key,
      true,
      "mcpServers 子树内键名应保持原样",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ConfigService.loadUserConfig: 应读取用户配置并合并 config-params", async () => {
  const tempDir = await createTempDir();
  try {
    await writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        default_provider: "openai",
        providers: {
          openai: {
            model: "gpt-4o",
            reasoning_effort_parameter: "reasoning_effort",
            reasoning_effort_options: ["none", "low", "medium", "high"],
            api_key: "${API_KEY}",
          },
        },
        workspace_root: "/blocked/by-policy",
      }),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, "config-params.json"),
      JSON.stringify({
        values: {
          API_KEY: "user-key",
          EMPTY_ONE: "   ",
        },
      }),
      "utf8",
    );

    const service = new ConfigService();

    const loaded = await service.loadUserConfig(tempDir);
    assert.equal(loaded.defaultProvider, "openai");
    assert.equal(loaded.providers?.openai?.api_key, "user-key");
    assert.equal(loaded.workspaceRoot, undefined, "workspace_root 应被策略过滤");
    assert.equal(loaded.configParams, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ConfigService.loadUserConfig: 缺少独立 config-params 文档时不读取配置内旧参数", async () => {
  const tempDir = await createTempDir();
  try {
    await writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        default_provider: "openai",
        providers: {
          openai: { model: "gpt-4o", api_key: "${NOOBOT_TEST_MISSING_CONFIG_PARAM}" },
        },
      }),
      "utf8",
    );

    const service = new ConfigService();

    const loaded = await service.loadUserConfig(tempDir);
    assert.equal(loaded.providers?.openai?.api_key, "");
    assert.equal(loaded.configParams, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ConfigService.loadUserConfig: user 为空时应回退读取 workspace/config-params.json", async () => {
  const workspaceRoot = await createTempDir();
  const userDir = path.join(workspaceRoot, "primary-user");
  try {
    await mkdir(userDir, { recursive: true });
    await writeFile(
      path.join(userDir, "config.json"),
      JSON.stringify({
        default_provider: "openai",
        providers: {
          openai: { model: "gpt-4o", api_key: "${API_KEY}" },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(workspaceRoot, "config-params.json"),
      JSON.stringify({
        values: {
          API_KEY: "workspace-new-key",
        },
      }),
      "utf8",
    );

    const service = new ConfigService();

    const loaded = await service.loadUserConfig(userDir);
    assert.equal(loaded.providers?.openai?.api_key, "workspace-new-key");
    assert.equal(loaded.configParams, undefined);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("ConfigService.loadUserConfig: 应按 user、workspace、env 顺序解析配置参数", async () => {
  const workspaceRoot = await createTempDir();
  const userDir = path.join(workspaceRoot, "primary-user");
  try {
    await mkdir(userDir, { recursive: true });
    await writeFile(
      path.join(userDir, "config.json"),
      JSON.stringify({
        default_provider: "openai",
        providers: {
          openai: {
            model: "gpt-4o",
            reasoning_effort_parameter: "reasoning_effort",
            reasoning_effort_options: ["none", "low", "medium", "high"],
            api_key: "${API_KEY}",
            base_url: "${BASE_URL}",
            env_fallback: "${ENV_ONLY}",
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(workspaceRoot, "config-params.json"),
      JSON.stringify({
        values: {
          API_KEY: "workspace-key",
          BASE_URL: "https://workspace.example.com",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(userDir, "config-params.json"),
      JSON.stringify({
        values: {
          API_KEY: "user-key",
          BASE_URL: "   ",
        },
      }),
      "utf8",
    );

    const service = new ConfigService({
      env: {
        API_KEY: "environment-key",
        BASE_URL: "https://environment.example.com",
        ENV_ONLY: "environment-fallback",
      },
    });

    const loaded = await service.loadUserConfig(userDir);
    assert.equal(loaded.providers?.openai?.api_key, "user-key");
    assert.equal(loaded.providers?.openai?.base_url, "https://workspace.example.com");
    assert.equal(loaded.providers?.openai?.env_fallback, "environment-fallback");
    assert.equal(loaded.configParams, undefined);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("ConfigService.loadUserConfig: config.json 非法 JSON 时应抛出可恢复错误", async () => {
  const tempDir = await createTempDir();
  try {
    await writeFile(path.join(tempDir, "config.json"), "{invalid json", "utf8");
    const service = new ConfigService();

    await assert.rejects(
      () => service.loadUserConfig(tempDir),
      (error) =>
        error && error.name === "NoobotError" && error.code === "RECOVERABLE_INVALID_USER_CONFIG",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ConfigService.loadUserConfig: config-params.json 非法时应抛出可恢复错误", async () => {
  const tempDir = await createTempDir();
  try {
    await writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify({
        default_provider: "openai",
        providers: {
          openai: { model: "gpt-4o", api_key: "${API_KEY}" },
        },
      }),
      "utf8",
    );
    await writeFile(path.join(tempDir, "config-params.json"), "{broken json", "utf8");

    const service = new ConfigService();

    await assert.rejects(
      () => service.loadUserConfig(tempDir),
      (error) =>
        error && error.name === "NoobotError" && error.code === "RECOVERABLE_INVALID_USER_CONFIG",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
