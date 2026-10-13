/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const path = require("node:path");
const {
  WORKSPACE_ROOT_ENV,
  resolveConfiguredWorkspaceRoot,
  resolveGlobalConfigPath,
  toProcessEnv,
} = require("@noobot/runtime-topology-protocol");

const root = __dirname;
const serviceDir = path.join(root, "service");
const runtimeEnv = toProcessEnv(process.env);
const workspaceRoot = resolveConfiguredWorkspaceRoot({
  globalConfigPath: resolveGlobalConfigPath({ serviceDir, env: process.env }),
  serviceDir,
});
const serviceEnv = {
  PORT: runtimeEnv.PORT,
  [WORKSPACE_ROOT_ENV]: workspaceRoot,
  ...(process.env.NOOBOT_USER_INTERACTION_TIMEOUT_MS
    ? { NOOBOT_USER_INTERACTION_TIMEOUT_MS: process.env.NOOBOT_USER_INTERACTION_TIMEOUT_MS }
    : {}),
};

module.exports = {
  apps: [
    {
      name: "noobot-service",
      cwd: serviceDir,
      script: "app.js",
      interpreter: process.execPath,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      kill_timeout: 5000,
      wait_ready: false,
      merge_logs: true,
      env: serviceEnv,
    },
    {
      name: "noobot-agent-proxy",
      cwd: path.join(root, "agent-proxy"),
      script: "agent-proxy.js",
      interpreter: process.execPath,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      kill_timeout: 5000,
      wait_ready: false,
      merge_logs: true,
      env: {
        AGENT_PROXY_PORT: runtimeEnv.AGENT_PROXY_PORT,
        AGENT_PROXY_HOST: runtimeEnv.AGENT_PROXY_HOST,
        AGENT_PROXY_UPSTREAM_WS_URL: runtimeEnv.AGENT_PROXY_UPSTREAM_WS_URL,
        AGENT_PROXY_UPSTREAM_HTTP_BASE: runtimeEnv.AGENT_PROXY_UPSTREAM_HTTP_BASE,
        // noobot-client (Caddy) below runs on this host and reverse-proxies over loopback.
        AGENT_PROXY_TRUSTED_PROXIES: "127.0.0.1,::1",
        [WORKSPACE_ROOT_ENV]: workspaceRoot,
      },
    },
    {
      name: "noobot-model-proxy",
      cwd: path.join(root, "model-proxy"),
      script: "src/index.js",
      interpreter: process.execPath,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      kill_timeout: 5000,
      wait_ready: false,
      merge_logs: true,
    },
    {
      name: "noobot-client",
      cwd: path.join(root, "client/noobot-chat"),
      script: "deploy/run-caddy.sh",
      interpreter: "/bin/bash",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      kill_timeout: 5000,
      wait_ready: false,
      merge_logs: true,
      env: {
        CADDY_ADDR: runtimeEnv.CADDY_ADDR,
        AGENT_PROXY_UPSTREAM: runtimeEnv.AGENT_PROXY_UPSTREAM,
      },
    },
  ],
};
