/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createTestHookManager as createAgentHookManager,
  createTestModelResponse,
  createTestResolveModelMessages,
} from "./public-runtime-fixtures.js";
import { registerHarnessCore as registerHarnessCoreImpl } from "../../src/index.js";
import { exists, waitForFile, readJsonl } from "../test-helpers.js";

function assertFlatCapabilityMessages(messages = []) {
  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length >= 1, true);
  const roles = messages.map((item = {}) => String(item?.role || "").trim());
  assert.equal(
    roles.every((role) => ["system", "user", "assistant", "tool"].includes(role)),
    true,
  );
  const first = messages[0] || {};
  const last = messages[messages.length - 1] || {};
  assert.equal(["system", "user", "assistant", "tool"].includes(String(first.role || "")), true);
  assert.equal(["system", "user", "assistant", "tool"].includes(String(last.role || "")), true);
}

function registerHarnessCore(api = {}, options = {}) {
  return registerHarnessCoreImpl(api, {
    resolveModelMessages: createTestResolveModelMessages(),
    ...options,
  });
}

export {
  assert,
  assertFlatCapabilityMessages,
  createAgentHookManager,
  createTestModelResponse,
  exists,
  fs,
  os,
  path,
  readJsonl,
  registerHarnessCore,
  test,
  waitForFile,
};
