import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { loadGlobalConfig } from "../../../system-core/config/core/global-config-loader.js";
import { ConfigService } from "../../../system-core/config/core/config-service.js";

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
        run_timeout_ms: 12345,
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

    const service = new ConfigService({
      globalConfig: {
        configParams: {
          API_KEY: "global-key",
          BASE_URL: "https://api.example.com",
        },
      },
    });

    const loaded = await service.loadUserConfig(tempDir);
    assert.equal(loaded.defaultProvider, "openai");
    assert.equal(loaded.providers?.openai?.api_key, "user-key");
    assert.equal(loaded.workspaceRoot, undefined, "workspace_root 应被策略过滤");
    assert.deepEqual(loaded.configParams, {
      API_KEY: "user-key",
      BASE_URL: "https://api.example.com",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ConfigService.loadUserConfig: 缺少 config-params.json 时应使用全局参数回退", async () => {
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

    const service = new ConfigService({
      globalConfig: {
        configParams: {
          API_KEY: "global-only-key",
        },
      },
    });

    const loaded = await service.loadUserConfig(tempDir);
    assert.equal(loaded.providers?.openai?.api_key, "global-only-key");
    assert.deepEqual(loaded.configParams, { API_KEY: "global-only-key" });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ConfigService.loadUserConfig: config.json 非法 JSON 时应抛出可恢复错误", async () => {
  const tempDir = await createTempDir();
  try {
    await writeFile(path.join(tempDir, "config.json"), "{invalid json", "utf8");
    const service = new ConfigService({ globalConfig: {} });

    await assert.rejects(
      () => service.loadUserConfig(tempDir),
      (error) =>
        error &&
        error.name === "NoobotError" &&
        error.code === "RECOVERABLE_INVALID_USER_CONFIG",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ConfigService.loadUserConfig: config-params.json 非法时应忽略并继续读取", async () => {
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

    const service = new ConfigService({
      globalConfig: {
        configParams: {
          API_KEY: "global-fallback-key",
        },
      },
    });

    const loaded = await service.loadUserConfig(tempDir);
    assert.equal(loaded.providers?.openai?.api_key, "global-fallback-key");
    assert.deepEqual(loaded.configParams, { API_KEY: "global-fallback-key" });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
