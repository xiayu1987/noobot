/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeMessageEntity, normalizeTaskEntity } from "../../src/session/entities.js";
import { resolveDefaultModelSpec, resolveSkillModelSpec } from "../../src/models/resolver/index.js";

function createBaseGlobalConfig(overrides = {}) {
  return {
    defaultModel: "openai:gpt-4",
    defaultProvider: "openai",
    maxContextTurns: 50,
    ...overrides,
    providers: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "${OPENAI_API_KEY}",
        enabled: true,
        model: "gpt-4",
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high"],
        contextWindow: 8192,
        maxTokens: 4096,
        models: {
          "gpt-4": { alias: "gpt4", contextWindow: 8192, maxTokens: 4096 },
          "gpt-3.5-turbo": { alias: "gpt35", contextWindow: 4096, maxTokens: 2048 },
        },
      },
      anthropic: {
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "${ANTHROPIC_API_KEY}",
        enabled: true,
        model: "claude-3-opus",
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high"],
        contextWindow: 200000,
        maxTokens: 4096,
        models: {
          "claude-3-opus": { alias: "opus", contextWindow: 200000, maxTokens: 4096 },
          "claude-3-sonnet": { alias: "sonnet", contextWindow: 200000, maxTokens: 4096 },
        },
      },
      ...(overrides.providers || {}),
    },
  };
}

function createBaseUserConfig(overrides = {}) {
  return {
    defaultModel: overrides.defaultModel || null,
    defaultProvider: overrides.defaultProvider || null,
    maxContextTurns: overrides.maxContextTurns || null,
    providers: overrides.providers || {},
    ...(overrides.extra || {}),
  };
}

describe("8. 综合集成测试", () => {
  describe("完整执行流程数据流", () => {
    it("配置优先级链应正确影响模型选择", () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: "openai" });

      const spec1 = resolveDefaultModelSpec({
        globalConfig,
        userConfig: createBaseUserConfig({}),
      });
      assert.equal(spec1.alias, "openai", "应使用 global 默认");

      const spec2 = resolveDefaultModelSpec({
        globalConfig,
        userConfig: createBaseUserConfig({ defaultProvider: "anthropic" }),
      });
      assert.equal(spec2.alias, "anthropic", "应使用 user 配置");

      const skillConfig = { provider: "openai" };
      const spec3 = resolveSkillModelSpec({
        skillConfig,
        globalConfig,
        userConfig: createBaseUserConfig({ defaultProvider: "anthropic" }),
      });
      assert.equal(spec3.alias, "openai", "skill 应覆盖 user 和 global");
    });

    it("Session 实体规范化后字段应与落盘结构对齐", () => {
      const rawMsg = { role: "user", content: "test", type: "text", ts: Date.now() };
      const normalizedMsg = normalizeMessageEntity(rawMsg);

      assert.ok("role" in normalizedMsg, "应包含 role");
      assert.ok("content" in normalizedMsg, "应包含 content");
      assert.ok("type" in normalizedMsg, "应包含 type");
      assert.ok("ts" in normalizedMsg, "应包含 ts");

      const rawTask = { taskId: "task-1", taskName: "test", taskStatus: "completed" };
      const normalizedTask = normalizeTaskEntity(rawTask);

      assert.ok("taskId" in normalizedTask, "应包含 taskId");
      assert.ok("taskName" in normalizedTask, "应包含 taskName");
      assert.ok("taskStatus" in normalizedTask, "应包含 taskStatus");
      assert.ok("startedAt" in normalizedTask, "应包含 startedAt");
      assert.ok("endedAt" in normalizedTask, "应包含 endedAt");
    });

    it("模型切换后 spec 应保持完整字段", () => {
      const globalConfig = createBaseGlobalConfig({ defaultProvider: "openai" });
      const userConfig = createBaseUserConfig({});

      const spec = resolveDefaultModelSpec({ globalConfig, userConfig });
      assert.ok(spec !== null, "应能解析到 spec");

      const requiredSpecFields = ["alias", "operatorId", "adapterId", "model"];
      for (const field of requiredSpecFields) {
        assert.ok(field in spec, `spec 应包含字段: ${field}`);
      }
    });
  });
});
