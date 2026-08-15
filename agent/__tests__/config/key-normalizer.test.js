/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeKnownConfigKeys } from "@noobot/agent-config-protocol";

test("normalizeKnownConfigKeys: 应将已知 snake_case 键转换为 camelCase", () => {
  const input = {
    workspace_root: "/tmp/workspace",
    default_provider: "openai",
    runTimeoutMs: 120000,
    nested: {
      max_tool_loop_turns: 8,
    },
  };

  const out = normalizeKnownConfigKeys(input);
  assert.equal(out.workspaceRoot, "/tmp/workspace");
  assert.equal(out.defaultProvider, "openai");
  assert.equal(out.runTimeoutMs, 120000);
  assert.equal(out.nested.maxToolLoopTurns, 8);
});

test("normalizeKnownConfigKeys: mcp_servers 子树内键名应保持原样", () => {
  const input = {
    mcp_servers: {
      my_server: {
        keep_snake_key: true,
      },
    },
  };

  const out = normalizeKnownConfigKeys(input);
  assert.ok(out.mcpServers?.my_server);
  assert.equal(out.mcpServers.my_server.keep_snake_key, true);
});

test("normalizeKnownConfigKeys: 数组和基础类型应被安全处理", () => {
  const input = {
    mounts: [{ source: "/a", target: "/b", read_only: true }, "plain"],
    value: 1,
  };
  const out = normalizeKnownConfigKeys(input);
  assert.equal(Array.isArray(out.mounts), true);
  assert.equal(out.mounts[0].source, "/a");
  assert.equal(out.mounts[0].target, "/b");
  assert.equal(out.mounts[0].readOnly, true);
  assert.equal(out.mounts[1], "plain");
  assert.equal(out.value, 1);
});

test("normalizeKnownConfigKeys: 旧 execute_script 沙箱键不映射到全局隔离协议", () => {
  const out = normalizeKnownConfigKeys({
    tools: {
      execute_script: {
        sandbox_mode: true,
        sandbox_provider: {
          default: "docker",
          docker: { docker_container_scope: "global" },
        },
      },
    },
  });
  assert.equal(out.security?.executionIsolation, undefined);
  assert.equal(out.tools.execute_script.sandbox_mode, true);
  assert.equal(out.tools.execute_script.sandbox_provider.default, "docker");
});

test("normalizeKnownConfigKeys: 全局隔离协议只规范化自己的配置树", () => {
  const out = normalizeKnownConfigKeys({
    security: {
      execution_isolation: {
        mode: "sandbox",
        sandbox: {
          provider: "docker",
          scope: "user",
          container_name: "noobot-test",
          mounts: [{ source: "/a", target: "/data", read_only: true }],
        },
      },
    },
  });
  assert.deepEqual(out.security.executionIsolation, {
    mode: "sandbox",
    sandbox: {
      provider: "docker",
      scope: "user",
      containerName: "noobot-test",
      mounts: [{ source: "/a", target: "/data", readOnly: true }],
    },
  });
});
