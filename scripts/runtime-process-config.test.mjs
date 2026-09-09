/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const TOPOLOGY_ENV_KEYS = [
  "PORT",
  "CADDY_ADDR",
  "AGENT_PROXY_HOST",
  "AGENT_PROXY_PORT",
  "AGENT_PROXY_UPSTREAM",
  "AGENT_PROXY_UPSTREAM_WS_URL",
  "AGENT_PROXY_UPSTREAM_HTTP_BASE",
];

function captureTopologyEnv() {
  const snapshot = new Map();
  for (const key of TOPOLOGY_ENV_KEYS) {
    snapshot.set(key, process.env[key]);
    delete process.env[key];
  }
  return snapshot;
}

function restoreTopologyEnv(snapshot) {
  for (const [key, value] of snapshot) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

test("PM2 ecosystem assigns runtime environment to the owning process", () => {
  const previous = captureTopologyEnv();
  try {
    process.env.PORT = "31061";
    process.env.CADDY_ADDR = ":31060";
    process.env.AGENT_PROXY_UPSTREAM = "127.0.0.1:31062";
    const ecosystemPath = require.resolve("../ecosystem.noobot.config.cjs");
    delete require.cache[ecosystemPath];
    const apps = new Map(require(ecosystemPath).apps.map((app) => [app.name, app]));
    assert.equal(apps.get("noobot-service")?.env?.PORT, "31061");
    assert.equal(
      apps.get("noobot-agent-proxy")?.env?.AGENT_PROXY_UPSTREAM_WS_URL,
      "ws://127.0.0.1:31061/chat/ws",
    );
    assert.equal(
      apps.get("noobot-agent-proxy")?.env?.AGENT_PROXY_UPSTREAM_HTTP_BASE,
      "http://127.0.0.1:31061",
    );
    assert.equal(apps.get("noobot-client")?.env?.CADDY_ADDR, ":31060");
    assert.equal(apps.get("noobot-client")?.env?.AGENT_PROXY_UPSTREAM, "127.0.0.1:31062");
    assert.equal(apps.get("noobot-model-proxy")?.env, undefined);
  } finally {
    restoreTopologyEnv(previous);
  }
});
