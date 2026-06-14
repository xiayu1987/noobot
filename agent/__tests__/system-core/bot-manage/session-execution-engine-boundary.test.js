/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_SOURCE_PATH = path.resolve(
  __dirname,
  "../../../src/system-core/bot-manage/session/session-execution-engine.js",
);
const SESSION_EXTENSION_ADAPTER_SOURCE_PATH = path.resolve(
  __dirname,
  "../../../src/system-core/bot-manage/session/session-plugin-runtime-adapter.js",
);

test("SessionExecutionEngine keeps plugin runtime details behind adapter boundary", async () => {
  const source = await readFile(ENGINE_SOURCE_PATH, "utf8");
  assert.equal(source.includes("../../plugin/plugin-loader.js"), false);
  assert.equal(source.includes("../../plugin/capabilities.js"), false);
  assert.equal(source.includes("getNoobotPluginRuntime"), false);
  assert.equal(source.includes("PLUGIN_CAPABILITY"), false);
  assert.equal(source.includes("agentPlugin"), false);
  assert.equal(source.includes("Harness"), false);
  assert.equal(source.includes("botPlugin"), false);
  assert.equal(source.includes("Workflow"), false);
});

test("SessionExecutionEngine imports capability-oriented helpers instead of concrete plugin files", async () => {
  const source = await readFile(ENGINE_SOURCE_PATH, "utf8");
  assert.equal(source.includes("harness-runtime-helpers"), false);
  assert.equal(source.includes("workflow-persistence-helpers"), false);
  assert.equal(source.includes("workflow-subsession-runner"), false);
  assert.equal(source.includes("HarnessRuntimeHelpers"), false);
  assert.equal(source.includes("WorkflowPersistenceHelpers"), false);
  assert.equal(source.includes("createWorkflowSubSessionRunner"), false);
});

test("session plugin runtime adapter is descriptor-driven and not tied to concrete plugins", async () => {
  const source = await readFile(SESSION_EXTENSION_ADAPTER_SOURCE_PATH, "utf8");
  assert.equal(source.includes("../../plugin/plugin-loader.js"), false);
  assert.equal(source.includes("../../plugin/capabilities.js"), false);
  assert.equal(source.includes("getNoobotPluginRuntime"), false);
  assert.equal(source.includes("PLUGIN_CAPABILITY"), false);
  assert.equal(source.includes("agentPlugin"), false);
  assert.equal(source.includes("Harness"), false);
  assert.equal(source.includes("botPlugin"), false);
  assert.equal(source.includes("Workflow"), false);
  assert.equal(source.includes("HARNESS_PLUGIN_KEY"), false);
  assert.equal(source.includes("WORKFLOW_PLUGIN_KEY"), false);
});
