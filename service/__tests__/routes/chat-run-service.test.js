/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createChatRunService } from "../../services/chat-run-service.js";

function createService() {
  return createChatRunService({
    getBot: () => ({}),
    normalizeLocale: (locale = "") => String(locale || "").trim() || "zh-CN",
    defaultLocale: "zh-CN",
    translateText: (key = "") => String(key || ""),
  });
}

test("chat-run-service: normalizeRunConfig should accept canonical runTimeoutMs", () => {
  const service = createService();

  const normalized = service.normalizeRunConfig({
    runTimeoutMs: 12345,
    locale: "en-US",
  });

  assert.equal(normalized.runTimeoutMs, 12345);
  assert.equal(normalized.locale, "en-US");
});

test("chat-run-service: normalizeRunConfig should keep canonical runTimeoutMs", () => {
  const service = createService();

  const normalized = service.normalizeRunConfig({
    runTimeoutMs: 23456,
  });

  assert.equal(normalized.runTimeoutMs, 23456);
});

test("chat-run-service: normalizeRunConfig should parse streaming boolean strings", () => {
  const service = createService();

  assert.equal(service.normalizeRunConfig({ streaming: "false" }).streaming, false);
  assert.equal(service.normalizeRunConfig({ streaming: "0" }).streaming, false);
  assert.equal(service.normalizeRunConfig({ streaming: "true" }).streaming, true);
  assert.equal(service.normalizeRunConfig({ streaming: "1" }).streaming, true);
});


test("chat-run-service: normalizeRunConfig should omit streaming when not provided", () => {
  const service = createService();

  assert.equal(Object.prototype.hasOwnProperty.call(service.normalizeRunConfig({}), "streaming"), false);
});

test("chat-run-service: normalizeRunConfig should preserve explicit sanitizeOutput opt-out", () => {
  const service = createService();

  assert.equal(service.normalizeRunConfig({ sanitizeOutput: false }).sanitizeOutput, false);
  assert.equal(service.normalizeRunConfig({ sanitizeOutput: "false" }).sanitizeOutput, false);
  assert.equal(service.normalizeRunConfig({ sanitizeOutput: true }).sanitizeOutput, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(service.normalizeRunConfig({}), "sanitizeOutput"),
    false,
  );
});

test("chat-run-service: normalizeRunConfig should preserve memory model for top-level and agent compat config", () => {
  const service = createService();
  const normalized = service.normalizeRunConfig({ memoryModel: "  memory-gpt  ", scenario: "programming" });
  assert.equal(normalized.memoryModel, "memory-gpt");
  assert.equal(normalized.config.memoryModel, "memory-gpt");
  assert.equal(normalized.config.scenario, "programming");
});

test("chat-run-service: normalizeRunConfig should preserve selected model for top-level and agent compat config", () => {
  const service = createService();

  const normalized = service.normalizeRunConfig({
    scenario: "programming",
    selectedModel: "  gpt-5.5  ",
  });

  assert.equal(normalized.selectedModel, "gpt-5.5");
  assert.equal(normalized.config.selectedModel, "gpt-5.5");
  assert.equal(normalized.config.scenario, "programming");
});

test("chat-run-service: normalizeRunConfig should preserve plugin model config for top-level and agent compat config", () => {
  const service = createService();
  const pluginModelConfig = {
    " web_search ": { semanticModel: "gpt-4.1-mini", stepModels: { search: "gpt-4.1" } },
    "": { semanticModel: "ignored" },
    invalid: null,
  };

  const normalized = service.normalizeRunConfig({ pluginModelConfig });

  assert.deepEqual(normalized.pluginModelConfig, {
    web_search: { semanticModel: "gpt-4.1-mini", stepModels: { search: "gpt-4.1" } },
  });
  assert.deepEqual(normalized.config.pluginModelConfig, normalized.pluginModelConfig);
});

test("chat-run-service: normalizeRunConfig should omit empty selected model and empty plugin model config", () => {
  const service = createService();

  const normalized = service.normalizeRunConfig({
    selectedModel: "  ",
    pluginModelConfig: {},
  });

  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "selectedModel"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "pluginModelConfig"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "config"), false);
});

test("chat-run-service: normalizeRunConfig should preserve neutral turnScopeId", () => {
  const service = createService();

  const normalized = service.normalizeRunConfig({ turnScopeId: "  turn-scope:abc  " });

  assert.equal(normalized.turnScopeId, "turn-scope:abc");
});

