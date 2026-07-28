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

import { createAgentHookManager } from "../../../agent/src/system-core/hook/index.js";
import { registerNoobotPlugin } from "../src/index.js";
import { normalizeHookContextProtocol } from "../src/core/context.js";
import { injectPrompt, resolvePolicyPromptSelection } from "../src/tracing/buffer-manager.js";
import { buildDefaultPolicyPrompt } from "../src/tracing/policy-prompt-matrix.js";
import {
  applyDynamicPolicyPromptFromText,
  buildDynamicPolicyPromptProtocolInstruction,
} from "../src/capabilities/handlers/shared/workflow/dynamic-policy-prompt.js";
import { ensureHarnessBucket } from "../src/capabilities/handlers/shared.js";
import { HARNESS_PROMPT_INJECTION_ID_FIELD } from "../src/capabilities/handlers/shared/constants.js";
import { exists, waitForFile, readJsonl } from "./test-helpers.js";

test("dynamic policy prompt protocol instruction is localized", () => {
  const zh = buildDynamicPolicyPromptProtocolInstruction("zh-CN");
  assert.match(zh, /可选动态策略提示词协议/);
  assert.match(zh, /\[HARNESS_DYNAMIC_POLICY_PROMPT\]/);
  assert.match(zh, /<用于替换默认场景提示词的策略提示词>/);
  assert.match(zh, /根据用户实际意图判断是否需要调整处理风格/);
  assert.match(zh, /scenario 必须符合用户实际意图/);
  assert.match(zh, /只描述处理事情的风格\/执行策略/);
  assert.match(zh, /不要涉及具体任务本身、任务结论、计划项、文件名或业务内容/);
  assert.match(zh, /尽量简洁/);
  assert.match(zh, /文本示例：/);
  assert.match(zh, /文本场景动态策略/);
  assert.match(zh, /复杂任务必须先分文件/);
  assert.match(zh, /每批.*检查/);
  assert.match(zh, /边查\/边搜\/边核对，边写\/边产出/);
  assert.match(zh, /建议每轮推进一个可交付单元/);
  assert.match(zh, /编程示例：/);
  assert.match(zh, /编程场景动态策略/);
  assert.match(zh, /快速定位问题与影响范围/);
  assert.match(zh, /复用现有结构、方法、字段/);
  assert.match(zh, /面对复杂任务时/);
  assert.match(zh, /消除旧入口、旧字段、兼容分支、重复存储和废弃逻辑等残留/);
  assert.match(zh, /连续多个最小切片推进任务/);
  assert.match(zh, /不做临时补丁式绕过/);
  assert.match(zh, /不只做一个小改就停下/);
  assert.doesNotMatch(zh, /Optional dynamic policy prompt protocol/);

  const en = buildDynamicPolicyPromptProtocolInstruction("en-US");
  assert.match(en, /Optional dynamic policy prompt protocol/);
  assert.match(en, /\[HARNESS_DYNAMIC_POLICY_PROMPT\]/);
  assert.match(en, /<policy prompt replacing the default scenario prompt>/);
  assert.match(en, /Judge from the user's actual intent whether the handling style should be adjusted/);
  assert.match(en, /scenario must match the user's actual intent/);
  assert.match(en, /describe only the handling style\/execution policy/);
  assert.match(en, /not the concrete task, task conclusions, plan items, file names, or business content/);
  assert.match(en, /Keep it concise/);
  assert.match(en, /Text example:/);
  assert.match(en, /Text-scenario dynamic policy/);
  assert.match(en, /complex tasks must be split into files first/);
  assert.match(en, /each batch/);
  assert.match(en, /Search\/check while writing and producing/i);
  assert.match(en, /recommended to advance one deliverable unit each turn/);
  assert.match(en, /Programming example:/);
  assert.match(en, /Programming-scenario dynamic policy/);
  assert.match(en, /quickly locate the issue and impact scope/);
  assert.match(en, /reusing existing structures, methods, fields/);
  assert.match(en, /for complex tasks/);
  assert.match(en, /remove leftovers such as old entry points, legacy fields, compatibility branches, duplicate storage, and deprecated logic/);
  assert.match(en, /multiple smallest slices/);
  assert.match(en, /temporary patch-style bypasses/);
  assert.match(en, /do not stop after only one tiny change/);
  assert.doesNotMatch(en, /可选动态策略提示词协议/);
});

test("dynamic policy prompt overrides default scenario policy prompt", async () => {
  const ctx = {
    messages: [{ role: "user", content: "continue" }],
    agentContext: {
      payload: {
        harness: {
          dynamicPolicyPrompt: {
            scenario: "text",
            source: "planning",
            stage: "planning",
            reason: "task-specific text delivery policy",
            prompt: "Dynamic output policy: produce deliverable batches and preserve citations.",
            updatedAt: "2026-06-19T00:00:00.000Z",
          },
        },
      },
    },
  };

  const prompt = buildDefaultPolicyPrompt("en-US", ctx, {});
  assert.match(prompt, /\[HARNESS_POLICY_SELECTION\]/);
  assert.match(prompt, /scenario = text/);
    assert.match(prompt, /policy_prompt = harness_policy\/dynamic\/text/);
  assert.match(prompt, /Dynamic output policy: produce deliverable batches and preserve citations\./);
  assert.doesNotMatch(prompt, /source = planning/);
  assert.doesNotMatch(prompt, /reason = task-specific text delivery policy/);
  assert.doesNotMatch(prompt, /updated_at/);
  assert.doesNotMatch(prompt, /Noobot Harness text-scenario\/text-delivery policy/);

  await injectPrompt("before_llm_call", ctx, {
    enabled: true,
    promptPolicy: true,
    promptText: "",
    promptPriority: 80,
    writePrompts: false,
  });
  assert.match(
    String(ctx.messages[0]?.content || ""),
    /Dynamic output policy: produce deliverable batches and preserve citations/,
  );
  assert.equal(
    ctx.messages.filter((item = {}) =>
      /\[HARNESS_POLICY_SELECTION\]/.test(String(item?.content || "")),
    ).length,
    1,
  );
});

test("dynamic policy prompt change refreshes the unique main-flow policy selection", async () => {
  const ctx = {
    messages: [{ role: "user", content: "continue" }],
    agentContext: { payload: { harness: {} } },
  };

  applyDynamicPolicyPromptFromText(ctx, [
    "[HARNESS_DYNAMIC_POLICY_PROMPT]",
    "scenario = text",
    "reason = first policy",
    "prompt:",
    "Dynamic policy one",
    "[/HARNESS_DYNAMIC_POLICY_PROMPT]",
  ].join("\n"), { source: "planning", stage: "planning" });

  await injectPrompt("before_llm_call", ctx, {
    enabled: true,
    promptPolicy: true,
    promptText: "",
    promptPriority: 80,
    writePrompts: false,
  });
  assert.equal(ctx.agentContext.payload.harness.policyPromptRefresh.pending, false);
  assert.equal(
    ctx.messages.filter((item = {}) => /\[HARNESS_POLICY_SELECTION\]/.test(String(item?.content || ""))).length,
    1,
  );
  assert.match(String(ctx.messages[0]?.content || ""), /Dynamic policy one/);

  applyDynamicPolicyPromptFromText(ctx, [
    "[HARNESS_DYNAMIC_POLICY_PROMPT]",
    "scenario = programming",
    "reason = changed policy",
    "prompt:",
    "Dynamic policy two",
    "[/HARNESS_DYNAMIC_POLICY_PROMPT]",
  ].join("\n"), { source: "planning_revision", stage: "revision" });
  assert.equal(ctx.agentContext.payload.harness.policyPromptRefresh.pending, true);

  await injectPrompt("before_llm_call", ctx, {
    enabled: true,
    promptPolicy: true,
    promptText: "",
    promptPriority: 80,
    writePrompts: false,
  });

  const policyMessages = ctx.messages.filter((item = {}) =>
    /\[HARNESS_POLICY_SELECTION\]/.test(String(item?.content || "")),
  );
  assert.equal(policyMessages.length, 1);
  assert.match(String(policyMessages[0]?.content || ""), /scenario = programming/);
  assert.match(String(policyMessages[0]?.content || ""), /Dynamic policy two/);
  assert.doesNotMatch(String(policyMessages[0]?.content || ""), /Dynamic policy one/);
  assert.equal(ctx.agentContext.payload.harness.policyPromptRefresh.pending, false);
});

test("harness policy prompt survives agent-side system message compaction", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      trace: false,
    },
  );
  const ctx = {
    userId: "u-policy-compact",
    sessionId: "s-policy-compact",
    dialogProcessId: "dp-policy-compact",
    messageBlocks: {
      system: [{ role: "system", content: "base system" }],
      history: [],
      incremental: [{ role: "user", content: "hello" }],
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  assert.equal(
    ctx.messages.filter((item = {}) =>
      item?.[HARNESS_PROMPT_INJECTION_ID_FIELD] === "noobot-harness-policy",
    ).length,
    1,
  );
  assert.equal(
    ctx.messageBlocks.system.filter((item = {}) =>
      item?.[HARNESS_PROMPT_INJECTION_ID_FIELD] === "noobot-harness-policy",
    ).length,
    1,
  );
});

test("harness policy preservation ignores ordinary system text that only mentions policy marker", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-"));
  const hookManager = createAgentHookManager();
  registerNoobotPlugin(
    { hookManager },
    {
      basePath,
      trace: false,
      promptPolicy: false,
      resolveModelMessages: () => [],
    },
  );
  const ctx = {
    userId: "u-policy-false-positive",
    sessionId: "s-policy-false-positive",
    dialogProcessId: "dp-policy-false-positive",
    messageBlocks: {
      system: [{ role: "system", content: "ordinary docs mention <!-- noobot-harness-policy --> but not a prompt marker" }],
      history: [],
      incremental: [{ role: "user", content: "hello" }],
    },
  };

  await hookManager.emit("before_llm_call", ctx);

  assert.equal(
    ctx.messages.some((item = {}) =>
      String(item?.content || "").includes("ordinary docs mention"),
    ),
    false,
  );
});

