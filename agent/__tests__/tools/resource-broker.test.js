/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerResource, getRegisteredResource } from "../../src/tools/core/resource-broker.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

function runtime(basePath) {
  return {
    basePath,
    userId: "admin",
    globalConfig: {},
    userConfig: {},
    systemRuntime: { sessionId: "s-1", rootSessionId: "s-1" },
  };
}

test("resource broker reuses identity across host tool calls", async () => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), "noobot-resource-broker-"));
  const file = path.join(basePath, "report.txt");
  await writeFile(file, "one", "utf8");
  const scope = createTestAgentExecutionScope(runtime(basePath));
  const first = await registerResource({ agentContext: scope, executionPath: file });
  await writeFile(file, "two", "utf8");
  const second = await registerResource({
    agentContext: scope,
    executionPath: file,
    capabilities: { read: true, write: true, scriptInput: true },
  });
  assert.equal(second.resourceId, first.resourceId);
  assert.equal(
    getRegisteredResource({ agentContext: scope, resourceId: first.resourceId }).executionPath,
    file,
  );
});
