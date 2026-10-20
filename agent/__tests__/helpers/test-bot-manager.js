/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const testHeadlessStartupContext = Object.freeze({
  schemaVersion: 1,
  app: { name: "Noobot", platform: "web", channel: process.platform, packaged: false },
  paths: {
    backendRoot: "/tmp/noobot-test-backend",
    frontendRoot: "",
    pluginRootDir: "/tmp/noobot-test-backend/plugin",
    userDataDir: "",
  },
  service: { port: 10061, host: "", origin: "" },
  runtime: {
    node: process.version,
    cwd: "/tmp/noobot-test-backend",
    execPath: process.execPath,
    resourcesPath: "",
    env: {},
    dependencies: null,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
});

export function createTestBotManager(fields = {}) {
  return { startupContext: testHeadlessStartupContext, ...fields };
}
