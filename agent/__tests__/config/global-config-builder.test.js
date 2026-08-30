/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createGlobalConfigBuilder } from "../../src/config/core/global-config-builder.js";

test("createGlobalConfigBuilder: 支持 source + migrations + validators", async () => {
  let sourceCalled = 0;
  const builder = createGlobalConfigBuilder({
    sourceName: "memory-source",
    source: async () => {
      sourceCalled += 1;
      return {
        workspaceRoot: "/tmp/workspace",
        provider: {
          apiKey: "${API_KEY}",
        },
      };
    },
    migrations: [
      {
        name: "set-default-provider",
        migrate: ({ config }) => ({
          ...config,
          defaultProvider: config.defaultProvider || "openai",
        }),
      },
    ],
    validators: [
      {
        name: "workspace-root-required",
        validate: ({ resolvedConfig }) => ({
          ok: Boolean(String(resolvedConfig?.workspaceRoot || "").trim()),
        }),
      },
    ],
  });

  const built = await builder.build({
    configParams: { API_KEY: "k1" },
    env: {},
  });
  assert.equal(sourceCalled, 1);
  assert.equal(built.rawConfig.defaultProvider, "openai");
  assert.equal(built.resolvedConfig.provider.apiKey, "k1");
  assert.equal(built.metadata.source, "memory-source");
  assert.deepEqual(built.metadata.migrations, ["set-default-provider"]);
  assert.deepEqual(built.metadata.warnings, []);
});

test("createGlobalConfigBuilder: configParams 应优先于环境变量，环境变量仅作回退", async () => {
  const builder = createGlobalConfigBuilder({
    source: async () => ({
      provider: {
        apiKey: "${API_KEY}",
        baseUrl: "${BASE_URL}",
      },
    }),
  });

  const built = await builder.build({
    configParams: { API_KEY: "configured-key" },
    env: {
      API_KEY: "environment-key",
      BASE_URL: "https://environment.example.com",
    },
  });

  assert.equal(built.resolvedConfig.provider.apiKey, "configured-key");
  assert.equal(built.resolvedConfig.provider.baseUrl, "https://environment.example.com");
});

test("createGlobalConfigBuilder: loadRawConfig(reload=false) 使用缓存副本", async () => {
  let sourceCalled = 0;
  const builder = createGlobalConfigBuilder({
    source: async () => {
      sourceCalled += 1;
      return { workspaceRoot: "/tmp/workspace" };
    },
  });

  const first = await builder.loadRawConfig({ reload: true });
  const second = await builder.loadRawConfig({ reload: false });
  first.workspaceRoot = "/changed";

  assert.equal(sourceCalled, 1);
  assert.equal(second.workspaceRoot, "/tmp/workspace");
});

test("createGlobalConfigBuilder: validator 返回 warning 与失败场景", async () => {
  const builderWithWarning = createGlobalConfigBuilder({
    source: async () => ({ workspaceRoot: "/tmp/workspace" }),
    validators: [
      {
        name: "warning-only",
        validate: () => "config uses fallback defaults",
      },
    ],
  });
  const warningBuilt = await builderWithWarning.build();
  assert.deepEqual(warningBuilt.metadata.warnings, ["config uses fallback defaults"]);

  const builderWithFailure = createGlobalConfigBuilder({
    source: async () => ({ workspaceRoot: "" }),
    validators: [
      {
        name: "must-have-workspace-root",
        validate: ({ resolvedConfig }) => ({
          ok: Boolean(String(resolvedConfig?.workspaceRoot || "").trim()),
          error: "workspaceRoot is required",
        }),
      },
    ],
  });

  await assert.rejects(
    () => builderWithFailure.build(),
    (error) =>
      error &&
      String(error.message || "").includes("must-have-workspace-root") &&
      String(error.message || "").includes("workspaceRoot is required"),
  );
});

test("createGlobalConfigBuilder: source 原始 snake_case 配置应由 builder 统一规范化", async () => {
  const builder = createGlobalConfigBuilder({
    source: async () => ({
      workspace_root: "/tmp/workspace",
      default_provider: "openai",
    }),
    validators: [
      ({ resolvedConfig }) => ({
        ok: resolvedConfig.workspaceRoot === "/tmp/workspace",
      }),
    ],
  });

  const built = await builder.build();
  assert.equal(built.rawConfig.workspaceRoot, "/tmp/workspace");
  assert.equal(built.rawConfig.defaultProvider, "openai");
});

test("createGlobalConfigBuilder: providers 只通过唯一 ModelSpec 规范化入口", async () => {
  const builder = createGlobalConfigBuilder({
    source: async () => ({
      providers: {
        main: {
          model: "gpt-5.5",
          format: "openai_compatible",
          providerId: "openai",
          adapterId: "openai-compatible",
        },
      },
    }),
  });

  const built = await builder.build();
  assert.equal(built.rawConfig.providers.main.alias, "main");
  assert.equal(built.rawConfig.providers.main.temperature, 0.7);
  assert.equal(built.rawConfig.providers.main.top_p, undefined);
});

test("createGlobalConfigBuilder: 旧的不完整 provider 不阻断运行时构建", async () => {
  const legacyAlias = ["GLM", "5", "1"].join("_");
  const builder = createGlobalConfigBuilder({
    source: async () => ({
      defaultProvider: "current",
      providers: {
        current: {
          model: "gpt-5.4",
          format: "openai_compatible",
        },
        [legacyAlias]: {
          enabled: true,
          used_for_conversation: true,
          api_key: "${DASHSCOPE_API_KEY}",
          base_url: "${DASHSCOPE_API_ADDRESS}",
          model: "ZHIPU/GLM-5.1",
        },
      },
    }),
  });

  const built = await builder.build({
    configParams: {
      DASHSCOPE_API_KEY: "configured-key",
      DASHSCOPE_API_ADDRESS: "https://dashscope.example.com/compatible-mode/v1",
    },
  });

  assert.equal(built.resolvedConfig.providers.current.model, "gpt-5.4");
  assert.equal(built.resolvedConfig.providers[legacyAlias], undefined);
});

test("createGlobalConfigBuilder: derives protocol identities and removes providerId overrides", async () => {
  const builder = createGlobalConfigBuilder({
    source: async () => ({
      providers: {
        configured: {
          model: "gpt-4",
          format: "openai_compatible",
          providerId: "untrusted-override",
          adapterId: "untrusted-override",
        },
      },
    }),
  });

  const built = await builder.build();
  assert.equal(built.rawConfig.providers.configured.providerId, undefined);
  assert.equal(built.rawConfig.providers.configured.operatorId, "generic");
  assert.equal(built.rawConfig.providers.configured.adapterId, "openai-compatible");
});
