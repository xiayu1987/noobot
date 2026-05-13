import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeUserConfig } from "../../../system-core/config/core/user-override-policy.js";
import {
  applySessionModelOverride,
  mergeConfig,
} from "../../../system-core/config/core/config-merge.js";

test("sanitizeUserConfig: 应仅保留允许覆盖字段并规范化键名", () => {
  const out = sanitizeUserConfig({
    default_provider: "openai",
    run_timeout_ms: 9876,
    workspace_root: "/should-be-denied",
    providers: { openai: { model: "gpt-4o" } },
    unknownKey: "x",
  });
  assert.equal(out.defaultProvider, "openai");
  assert.equal(out.runTimeoutMs, 9876);
  assert.equal(out.workspaceRoot, undefined);
  assert.deepEqual(out.providers, { openai: { model: "gpt-4o" } });
  assert.equal("unknownKey" in out, false);
});

test("sanitizeUserConfig: runTimeoutMs 非法值应被过滤", () => {
  const out = sanitizeUserConfig({
    run_timeout_ms: -1,
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

test("applySessionModelOverride: 传入 alias 时应覆盖 defaultProvider", () => {
  const out = applySessionModelOverride({ defaultProvider: "openai" }, "anthropic");
  assert.equal(out.defaultProvider, "anthropic");
});

test("applySessionModelOverride: 空 alias 应保持原样", () => {
  const out = applySessionModelOverride({ defaultProvider: "openai" }, "");
  assert.equal(out.defaultProvider, "openai");
});
