import test from "node:test";
import assert from "node:assert/strict";

import { normalizeKnownConfigKeys } from "../../../src/system-core/config/core/key-normalizer.js";

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
    docker_mounts: [
      { mount_source: "/a", mount_target: "/b" },
      "plain",
    ],
    value: 1,
  };
  const out = normalizeKnownConfigKeys(input);
  assert.equal(Array.isArray(out.dockerMounts), true);
  assert.equal(out.dockerMounts[0].mountSource, "/a");
  assert.equal(out.dockerMounts[0].mountTarget, "/b");
  assert.equal(out.dockerMounts[1], "plain");
  assert.equal(out.value, 1);
});
