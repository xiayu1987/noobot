/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SandboxConfig = Object.freeze({
  PROVIDERS: Object.freeze({
    DOCKER: "docker",
    BUBBLEWRAP: "bubblewrap",
    FIREJAIL: "firejail",
  }),
  DOCKER: Object.freeze({
    DEFAULT_CONTAINER_SCOPE: "global",
    DEFAULT_CONTAINER_NAME: "noobot-script-sandbox",
    DEFAULT_IMAGE: "node:20",
  }),
  COMMANDS: Object.freeze({
    DOCKER: "docker",
    FIREJAIL: "firejail",
    BUBBLEWRAP: "bwrap",
  }),
  TOOL_POLICY_MODE: Object.freeze({
    CUSTOM_ONLY: "custom_only",
  }),
});

export const ConnectorType = Object.freeze({
  DATABASE: "database",
  TERMINAL: "terminal",
  EMAIL: "email",
  DATABASE_ENGINE: Object.freeze({
    SQLITE: "sqlite",
  }),
  TERMINAL_PROTOCOL: Object.freeze({
    SSH: "ssh",
  }),
  CHANNEL_BUCKET: Object.freeze({
    DATABASE: "databases",
    TERMINAL: "terminals",
    EMAIL: "emails",
  }),
  CONNECT_TOOL_NAME: Object.freeze({
    DATABASE: "database_connect_connector",
    TERMINAL: "terminal_connect_connector",
    EMAIL: "email_connect_connector",
  }),
});
