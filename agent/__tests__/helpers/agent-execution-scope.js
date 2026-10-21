/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createAgentContextEnvelope } from "@noobot/context-protocol/agent-context/envelope";
import { createAgentExecutionScope } from "../../src/context/agent-execution-scope.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

export const TEST_AGENT_IDENTITY = Object.freeze({
  userId: "u-test",
  sessionId: "s-1",
  rootSessionId: "s-1",
  parentSessionId: "",
  dialogProcessId: "d-1",
  turnScopeId: "t-1",
  runId: "r-1",
  presentationMessageId: "p-1",
});

export const EMPTY_TEST_MESSAGE_BLOCKS = Object.freeze({
  system: [],
  history: [],
  incremental: [],
});

export const TEST_AGENT_EXECUTION = Object.freeze({
  timestamp: "2026-01-01T00:00:00.000Z",
  caller: SESSION_CALLER.USER,
  flags: Object.freeze({ allowUserInteraction: true, safeConfirm: false }),
  model: Object.freeze({ runtimeModel: "", allEnabledProviders: Object.freeze({}) }),
  selectedConnectorIds: Object.freeze([]),
});

export function createTestAgentEnvironment({ basePath, platform = "linux", isSuperUser = false }) {
  return {
    os: { platform, arch: "x64", timezone: "UTC", nodeVersion: "v22.0.0" },
    workspace: { cwd: basePath, basePath, workspaceDirectories: [], globalDefaults: {} },
    permissions: { isSuperUser },
  };
}

export const TEST_AGENT_ENVIRONMENT = Object.freeze(
  createTestAgentEnvironment({ basePath: "/tmp/noobot-test-workspace" }),
);

export function createTestAgentExecutionScope(runtime, options = {}) {
  const {
    identity = TEST_AGENT_IDENTITY,
    environment = TEST_AGENT_ENVIRONMENT,
    execution = TEST_AGENT_EXECUTION,
    messageBlocks = EMPTY_TEST_MESSAGE_BLOCKS,
    tools = [],
    extensions = {},
  } = options;
  const context = createAgentContextEnvelope({
    identity,
    environment,
    execution,
    messageBlocks,
  });
  return createAgentExecutionScope({
    context,
    bindings: { runtime, tools, extensions },
  });
}
