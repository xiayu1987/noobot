/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeUserConfig } from "@noobot/agent-config-protocol";
import {
  applySessionModelOverride,
  hasOwnConfigKey,
  mergeConfig,
  normalizeBooleanLike,
  resolveRunConfigValue,
} from "@noobot/agent-config-protocol";

test("sanitizeUserConfig: 应仅保留允许覆盖字段并规范化键名", () => {
  const out = sanitizeUserConfig({
    default_provider: "openai",
    workspace_root: "/should-be-denied",
    providers: { openai: { model: "gpt-4o" } },
    unknownKey: "x",
  });
  assert.equal(out.defaultProvider, "openai");
  assert.equal(out.runTimeoutMs, undefined);
  assert.equal(out.workspaceRoot, undefined);
  assert.deepEqual(out.providers, { openai: { model: "gpt-4o" } });
  assert.equal(out.context, undefined);
  assert.equal("unknownKey" in out, false);
});

test("sanitizeUserConfig: runTimeoutMs 阈值配置应被过滤", () => {
  const out = sanitizeUserConfig({
    runTimeoutMs: -1,
  });
  assert.equal("runTimeoutMs" in out, false);
});

test("sanitizeUserConfig: 应剔除 tools.execute_script 覆盖", () => {
  const out = sanitizeUserConfig({
    tools: {
      execute_script: { enabled: false },
      safe_tool: { enabled: true },
    },
  });
  assert.deepEqual(out.tools, { safe_tool: { enabled: true } });
});

test("mergeConfig: 应按策略深度合并并合并 runtime configParams", () => {
  const globalConfig = {
    default_provider: "openai",
    providers: {
      openai: { model: "gpt-4o", temperature: 0.2 },
      anthropic: { model: "claude-3-7-sonnet" },
    },
    configParams: {
      A: "1",
      B: "2",
    },
  };
  const userConfig = {
    defaultProvider: "anthropic",
    providers: {
      openai: { temperature: 0.6 },
    },
    configParams: {
      b: "20",
      c: "30",
      EMPTY: "   ",
    },
  };

  const out = mergeConfig(globalConfig, userConfig);
  assert.equal(out.defaultProvider, "anthropic");
  assert.equal(out.providers.openai.model, "gpt-4o");
  assert.equal(out.providers.openai.temperature, 0.6);
  assert.equal(out.providers.anthropic.model, "claude-3-7-sonnet");
  assert.deepEqual(out.configParams, { A: "1", B: "20", C: "30" });
});

test("mergeConfig: providers 应深度合并并保留 tool_reasoning_effort", () => {
  const out = mergeConfig(
    {
      providers: {
        openai: {
          format: "openai_compatible",
          model: "gpt-5.5",
          reasoning_effort: "high",
          tool_reasoning_effort: "low",
        },
      },
    },
    {
      providers: {
        openai: {
          temperature: 0.6,
          tool_reasoning_effort: "medium",
        },
      },
    },
  );

  assert.equal(out.providers.openai.format, "openai_compatible");
  assert.equal(out.providers.openai.model, "gpt-5.5");
  assert.equal(out.providers.openai.reasoning_effort, "high");
  assert.equal(out.providers.openai.tool_reasoning_effort, "medium");
  assert.equal(out.providers.openai.temperature, 0.6);
});

test("mergeConfig: session/context/preferences 用户覆盖应保持深度合并", () => {
  const out = mergeConfig(
    {
      session: {
        contextWindow: { maxTokens: 1000, reserveTokens: 200 },
      },
      context: {
        mode: "full",
        sections: { services: true, tools: true },
      },
      preferences: {
        locale: "zh-CN",
        theme: { mode: "light", density: "comfortable" },
      },
    },
    {
      session: {
        contextWindow: { reserveTokens: 300 },
      },
      context: {
        sections: { tools: false },
      },
      preferences: {
        theme: { density: "compact" },
      },
    },
  );

  assert.deepEqual(out.session, {
    contextWindow: { maxTokens: 1000, reserveTokens: 300 },
  });
  assert.deepEqual(out.context, {
    mode: "full",
    sections: { services: true, tools: false },
  });
  assert.deepEqual(out.preferences, {
    locale: "zh-CN",
    theme: { mode: "light", density: "compact" },
  });
});

test("mergeConfig: admin 每类配置至少覆盖一项且不污染全局配置", () => {
  const globalConfig = {
    defaultProvider: "global-provider",
    providers: {
      global: { model: "global-model", temperature: 0.2 },
      shared: { model: "shared-global-model" },
    },
    attachments: {
      storage: "global-storage",
      maxFileCount: 10,
    },
    session: {
      mode: "global-mode",
      contextWindow: { maxTokens: 1000, reserveTokens: 100 },
    },
    context: {
      mode: "global-context",
      sections: { services: true, tools: true },
    },
    services: {
      globalService: { enabled: true },
      sharedService: { endpoint: "https://global.example.com" },
    },
    mcpServers: {
      globalServer: { command: "global-command" },
      sharedServer: { url: "https://global.example.com" },
    },
    tools: {
      globalTool: { enabled: true },
      sharedTool: { mode: "global-mode" },
    },
    plugins: {
      globalPlugin: { enabled: true },
      workflow: { enabled: true, timeoutMs: 1000 },
    },
    preferences: {
      locale: "zh-CN",
      theme: { mode: "light", density: "comfortable" },
    },
    scenarios: {
      default: "full",
      definitions: { programming: { model: "global-programming-model" } },
    },
    configParams: { GLOBAL_ONLY: "global-value", SHARED: "global-shared" },
  };
  const adminConfig = {
    defaultProvider: "admin-provider",
    providers: {
      admin: { model: "admin-model" },
      shared: { temperature: 0.8 },
    },
    attachments: {
      storage: "admin-storage",
      maxFileCount: 99,
    },
    session: { mode: "admin-mode", contextWindow: { reserveTokens: 250 } },
    context: { mode: "admin-context", sections: { tools: false } },
    services: {
      adminService: { enabled: true },
      sharedService: { endpoint: "https://admin.example.com" },
    },
    mcpServers: {
      adminServer: { command: "admin-command" },
      sharedServer: { headers: { authorization: "admin-token" } },
    },
    tools: {
      adminTool: { enabled: true },
      sharedTool: { mode: "admin-mode" },
      execute_script: { enabled: false },
    },
    plugins: {
      adminPlugin: { enabled: true },
      workflow: { enabled: false, timeoutMs: 9999 },
    },
    preferences: { locale: "en-US", theme: { density: "compact" } },
    scenarios: {
      default: "programming",
      definitions: { programming: { model: "admin-programming-model" } },
    },
    configParams: { shared: "admin-shared", ADMIN_ONLY: "admin-value" },
  };
  const globalBefore = structuredClone(globalConfig);
  const adminBefore = structuredClone(adminConfig);

  const out = mergeConfig(globalConfig, adminConfig);

  assert.equal(out.defaultProvider, "admin-provider");
  assert.equal(out.providers.global.model, "global-model");
  assert.equal(out.providers.shared.temperature, 0.8);
  assert.equal(out.attachments.storage, "admin-storage");
  assert.equal(out.attachments.maxFileCount, 10, "受保护的附件限制仍来自全局");
  assert.equal(out.session.mode, "admin-mode");
  assert.equal(out.session.contextWindow.maxTokens, 1000);
  assert.equal(out.session.contextWindow.reserveTokens, 250);
  assert.equal(out.context.mode, "admin-context");
  assert.equal(out.context.sections.services, true);
  assert.equal(out.context.sections.tools, false);
  assert.equal(out.services.sharedService.endpoint, "https://admin.example.com");
  assert.equal(out.mcpServers.sharedServer.url, "https://global.example.com");
  assert.equal(out.mcpServers.sharedServer.headers.authorization, "admin-token");
  assert.equal(out.tools.sharedTool.mode, "admin-mode");
  assert.equal(out.tools.execute_script, undefined, "execute_script 不允许用户覆盖");
  assert.equal(out.plugins.adminPlugin.enabled, true);
  assert.equal(out.plugins.workflow.enabled, false);
  assert.equal(out.plugins.workflow.timeoutMs, 1000, "工作流超时仍来自全局");
  assert.equal(out.preferences.locale, "en-US");
  assert.equal(out.preferences.theme.mode, "light");
  assert.equal(out.preferences.theme.density, "compact");
  assert.equal(out.scenarios.default, "programming");
  assert.equal(out.scenarios.definitions.programming.model, "admin-programming-model");
  assert.deepEqual(out.configParams, {
    GLOBAL_ONLY: "global-value",
    SHARED: "admin-shared",
    ADMIN_ONLY: "admin-value",
  });
  assert.deepEqual(globalConfig, globalBefore, "全局配置对象不得被合并过程修改");
  assert.deepEqual(adminConfig, adminBefore, "admin 配置对象不得被合并过程修改");
});

test("applySessionModelOverride: 传入 alias 时应覆盖 defaultProvider", () => {
  const out = applySessionModelOverride({ defaultProvider: "openai" }, "anthropic");
  assert.equal(out.defaultProvider, "anthropic");
});

test("applySessionModelOverride: 空 alias 应保持原样", () => {
  const out = applySessionModelOverride({ defaultProvider: "openai" }, "");
  assert.equal(out.defaultProvider, "openai");
});

test("resolveRunConfigValue: 显式 runConfig 值应覆盖配置默认值", () => {
  assert.equal(
    resolveRunConfigValue({
      runConfig: { streaming: false },
      config: { streaming: true },
      key: "streaming",
      normalize: (value) => normalizeBooleanLike(value, false),
      fallback: false,
    }),
    false,
  );
  assert.equal(
    resolveRunConfigValue({
      runConfig: { streaming: "true" },
      config: { streaming: false },
      key: "streaming",
      normalize: (value) => normalizeBooleanLike(value, false),
      fallback: false,
    }),
    true,
  );
});

test("resolveRunConfigValue: runConfig 未传字段时才复用配置默认值", () => {
  assert.equal(
    resolveRunConfigValue({
      runConfig: {},
      config: { streaming: "true" },
      key: "streaming",
      normalize: (value) => normalizeBooleanLike(value, false),
      fallback: false,
    }),
    true,
  );
  assert.equal(
    resolveRunConfigValue({
      runConfig: {},
      config: {},
      key: "streaming",
      normalize: (value) => normalizeBooleanLike(value, false),
      fallback: false,
    }),
    false,
  );
  assert.equal(hasOwnConfigKey({ streaming: false }, "streaming"), true);
});

test("sanitizeUserConfig: scenarios 仅允许默认情景与 programming.model", () => {
  const out = sanitizeUserConfig({
    scenarios: {
      default: "programming",
      definitions: {
        full: { name: "用户全能", tools: [] },
        programming: {
          name: "用户编程",
          model: "code-model",
          tools: ["unsafe_tool"],
          context: ["*"],
          services: ["custom_service"],
        },
        custom: { name: "自定义", model: "custom-model" },
      },
    },
  });

  assert.deepEqual(out.scenarios, {
    default: "programming",
    definitions: {
      programming: {
        model: "code-model",
      },
    },
  });
});

test("mergeConfig: full/programming/text 为内置情景且用户只能覆盖内置模型", () => {
  const out = mergeConfig(
    {
      scenarios: {
        default: "full",
        definitions: {
          full: { name: "全局全能覆盖", tools: [] },
          programming: {
            name: "全局编程覆盖",
            model: "global-code-model",
            tools: ["unsafe_global_tool"],
          },
          custom: { name: "全局自定义" },
        },
      },
    },
    {
      scenarios: {
        default: "programming",
        definitions: {
          full: { name: "用户全能覆盖", tools: [] },
          programming: {
            name: "用户编程覆盖",
            model: "user-code-model",
            tools: ["unsafe_user_tool"],
          },
          custom: { name: "用户自定义" },
        },
      },
    },
  );

  assert.equal(out.scenarios.default, "programming");
  assert.deepEqual(Object.keys(out.scenarios.definitions).sort(), ["full", "programming", "text"]);
  assert.equal(out.scenarios.definitions.full.name, "全能");
  assert.deepEqual(out.scenarios.definitions.full.tools, ["*"]);
  assert.equal(out.scenarios.definitions.programming.name, "编程");
  assert.equal(out.scenarios.definitions.programming.model, "user-code-model");
  assert.deepEqual(out.scenarios.definitions.programming.tools, [
    "read_file",
    "write_file",
    "search",
    "patch_file",
    "execute_script",
    "process_content_task",
    "user_interaction",
    "task_summary",
    "task_check",
    "request_help",
    "web_search",
  ]);
  assert.equal(out.scenarios.definitions.text.name, "文本");
  assert.equal(out.scenarios.definitions.text.model, "");
});
