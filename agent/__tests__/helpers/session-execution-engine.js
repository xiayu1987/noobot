/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";
import { createTestBotManager } from "./test-bot-manager.js";
import { createSessionPluginRuntimeBundle } from "../../src/extensions/plugins/session-plugin-runtime-provider.js";

export const testPluginRuntimeBundle = await createSessionPluginRuntimeBundle();

export function createTestSessionExecutionEngine(overrides = {}) {
  return new SessionExecutionEngine({
    globalConfig: {},
    session: {},
    memory: {},
    attach: {},
    skill: {},
    configService: {},
    workspaceService: { getWorkspacePath: (userId) => `/tmp/noobot-test-engine/${userId}` },
    errorLogger: { async log() {} },
    botManager: createTestBotManager(),
    agentRunner: async () => {
      throw new Error("test engine agentRunner not provided");
    },
    pluginRuntimeBundle: testPluginRuntimeBundle,
    ...overrides,
  });
}
