/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const path = require("node:path");

const root = __dirname;
const serviceEnv = {
  ...(process.env.NOOBOT_USER_INTERACTION_TIMEOUT_MS
    ? { NOOBOT_USER_INTERACTION_TIMEOUT_MS: process.env.NOOBOT_USER_INTERACTION_TIMEOUT_MS }
    : {}),
};

module.exports = {
  apps: [
    {
      name: "noobot-service",
      cwd: path.join(root, "service"),
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
    },
  ],
};
