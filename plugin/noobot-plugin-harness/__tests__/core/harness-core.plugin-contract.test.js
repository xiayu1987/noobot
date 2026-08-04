/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTestHookManager as createAgentHookManager } from "../helpers/public-runtime-fixtures.js";
import { registerNoobotPlugin } from "../../src/index.js";
import { injectPrompt, resolvePolicyPromptSelection } from "../../src/tracing/buffer-manager.js";
import { buildDefaultPolicyPrompt } from "../../src/tracing/policy-prompt-matrix.js";
import {
  applyDynamicPolicyPromptFromText,
  buildDynamicPolicyPromptProtocolInstruction,
} from "../../src/capabilities/handlers/shared/workflow/dynamic-policy-prompt.js";
import { ensureHarnessBucket } from "../../src/capabilities/handlers/shared.js";
import { HARNESS_PROMPT_INJECTION_ID_FIELD } from "../../src/capabilities/handlers/shared/constants.js";
import { exists, waitForFile, readJsonl } from "../test-helpers.js";

test("harness plugin injects prompt into before_llm_call messages", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  registerNoobotPlugin({ hookManager }, { basePath, trace: false });
  const messages = [{ role: "user", content: "hello" }];

  await hookManager.emit("agent.before_llm_call", {
    userId: "u2",
    sessionId: "s2",
    dialogProcessId: "dp2",
    messages,
  });

  assert.equal(messages[0].role, "system");
  assert.equal(messages[0]?.[HARNESS_PROMPT_INJECTION_ID_FIELD], "noobot-harness-policy");
  assert.doesNotMatch(messages[0].content, /noobot-harness-policy/);
  assert.match(messages[0].content, /用户隔离/);
});

test("harness plugin exposes capability handler skeleton and hook mapping in manifest", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  const calls = [];
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      promptPolicy: false,
      capabilityHandlers: {
        planning: async ({ point }) => {
          calls.push(point);
          return { capability: "planning", status: "planned" };
        },
      },
    },
  );

  await hookManager.emit("agent.before_turn", {
    userId: "u3",
    sessionId: "s3",
    dialogProcessId: "dp3",
    caller: "user",
    status: "start",
  });
  await hookManager.emit("agent.after_turn", {
    userId: "u3",
    sessionId: "s3",
    dialogProcessId: "dp3",
    caller: "user",
    status: "success",
  });

  assert.equal(calls.includes("agent.before_turn"), true);
  const runDir = path.join(basePath, "runtime", "harness", "runs", "dp3");
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  assert.equal(Array.isArray(manifest?.capabilities?.domains), true);
  assert.equal(typeof manifest?.capabilities?.hookMap, "object");
  assert.equal(
    manifest?.capabilities?.hookMap?.acceptance?.includes("agent.before_llm_call"),
    true,
  );
  assert.equal(
    manifest?.capabilities?.hookMap?.acceptance?.includes("agent.after_llm_call"),
    true,
  );
  assert.equal(
    manifest?.capabilities?.hookMap?.guidance?.includes("agent.after_llm_call"),
    true,
  );
  assert.equal(
    manifest?.capabilities?.hookMap?.guidance?.includes("agent.after_tool_calls"),
    true,
  );
});
