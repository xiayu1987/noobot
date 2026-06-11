import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeUserConfig } from "../../../src/system-core/config/core/user-override-policy.js";
import {
  applySessionModelOverride,
  hasOwnConfigKey,
  mergeConfig,
  normalizeBooleanLike,
  resolveRunConfigValue,
} from "../../../src/system-core/config/core/config-merge.js";

test("sanitizeUserConfig: 应仅保留允许覆盖字段并规范化键名", () => {
  const out = sanitizeUserConfig({
    default_provider: "openai",
    workspace_root: "/should-be-denied",
    providers: { openai: { model: "gpt-4o" } },
    context: {
      main_model_recent_window: true,
      main_model_recent_limit: 15,
    },
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
      B: "20",
      C: "30",
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

test("mergeConfig: session/context/preferences 用户覆盖应保持深度合并", () => {
  const out = mergeConfig(
    {
      session: {
        recentMessageLimit: 15,
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
    recentMessageLimit: 15,
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

test("mergeConfig: full/programming 为内置情景且用户只能覆盖 programming.model", () => {
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
  assert.deepEqual(Object.keys(out.scenarios.definitions).sort(), ["full", "programming"]);
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
    "task_summary",
    "request_help",
  ]);
});
