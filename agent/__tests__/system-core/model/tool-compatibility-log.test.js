/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  appendToolCompatibilityLog,
  buildToolCompatibilityLogLine,
} from "../../../src/system-core/model/tool/compatibility-log.js";

test("buildToolCompatibilityLogLine includes model and tools", () => {
  const line = buildToolCompatibilityLogLine({
    modelState: {
      activeModelAlias: "codex",
      activeModelName: "gpt-5.3-codex",
    },
    runtime: {
      userId: "primary-user",
      systemRuntime: {
        sessionId: "s1",
        parentSessionId: "p1",
      },
    },
    event: "tool_binding_adapter_strict_downgraded",
    tools: ["call_service"],
  });
  const parsed = JSON.parse(line);
  assert.equal(parsed.modelAlias, "codex");
  assert.equal(parsed.modelName, "gpt-5.3-codex");
  assert.deepEqual(parsed.tools, ["call_service"]);
});

test("appendToolCompatibilityLog writes file under workspace root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "noobot-workspace-"));
  const logPath = await appendToolCompatibilityLog({
    modelState: {
      activeModelAlias: "codex",
      activeModelName: "gpt-5.3-codex",
      globalConfig: {
        workspaceRoot: root,
      },
    },
    runtime: {},
    event: "tool_binding_adapter_dropped_tools",
    tools: ["invalid tool"],
  });
  const content = await readFile(logPath, "utf8");
  assert.equal(logPath, path.join(root, "tool-compatibility.log"));
  assert.equal(content.includes("tool_binding_adapter_dropped_tools"), true);
});

