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

test("harness policy prompt is promoted to system when stale policy exists in messageBlocks", async () => {
  const policyMessage = {
    role: "user",
    content: "<!-- noobot-harness-policy -->\npolicy",
    injectedMessage: true,
    injectedBy: "harness-plugin",
    injectedMessageType: "harness_prompt:noobot-harness-policy",
  };
  const ctx = {
    messages: [{ role: "user", content: "current compacted window without policy" }],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [policyMessage],
    },
  };

  await injectPrompt("before_llm_call", ctx, {
    enabled: true,
    promptPolicy: true,
    promptText: "policy",
    promptPriority: 80,
    writePrompts: false,
  });

  assert.equal(
    ctx.messages.filter((item = {}) =>
      item?.[HARNESS_PROMPT_INJECTION_ID_FIELD] === "noobot-harness-policy",
    ).length,
    1,
  );
  assert.equal(ctx.messages[0]?.role, "system");
  assert.equal(
    ctx.messageBlocks.system.filter((item = {}) =>
      item?.[HARNESS_PROMPT_INJECTION_ID_FIELD] === "noobot-harness-policy",
    ).length,
    1,
  );
  assert.equal(
    ctx.messageBlocks.incremental.filter((item = {}) =>
      item?.[HARNESS_PROMPT_INJECTION_ID_FIELD] === "noobot-harness-policy" ||
        String(item?.content || "").includes("noobot-harness-policy"),
    ).length,
    0,
  );
});

test("harness policy prompt matrix exposes scenario without workflow mode", async () => {
  const buildInjectedPolicy = async (extraOptions = {}, ctxPatch = {}) => {
    const ctx = { messages: [{ role: "user", content: "hello" }], ...ctxPatch };
    await injectPrompt("before_llm_call", ctx, {
      enabled: true,
      promptPolicy: true,
      promptText: "",
      promptPriority: 80,
      writePrompts: false,
      ...extraOptions,
    });
    return String(ctx.messages[0]?.content || "");
  };

  const generalPrompt = await buildInjectedPolicy();
  assert.doesNotMatch(generalPrompt, /noobot-harness-policy/);
  assert.match(generalPrompt, /\[HARNESS_POLICY_SELECTION\]/);
  assert.match(generalPrompt, /scenario = general/);
    assert.match(generalPrompt, /policy_prompt = harness_policy\/general/);
  assert.match(generalPrompt, /用户隔离/);
  assert.doesNotMatch(generalPrompt, new RegExp("执行" + "优先"));
  assert.match(generalPrompt, /最小切片/);
  assert.match(generalPrompt, /不断推进任务/);

  const textPrompt = await buildInjectedPolicy(
    {},
    { runConfig: { scenario: "text" } },
  );
  assert.match(textPrompt, /scenario = text/);
    assert.match(textPrompt, /policy_prompt = harness_policy\/text/);
  assert.match(textPrompt, /复杂任务必须先分文件/);
  assert.match(textPrompt, /外部文本到手先保真消费/);
  assert.match(textPrompt, /边查\/边搜\/边核对，边写\/边产出/);
  assert.match(textPrompt, /建议每轮推进一个可交付单元/);
  assert.match(textPrompt, /每批.*检查/);
  assert.match(textPrompt, /来源路径/);

  const programmingPrompt = await buildInjectedPolicy(
    {},
    { runConfig: { scenario: "programming" } },
  );
  assert.match(programmingPrompt, /scenario = programming/);
    assert.match(programmingPrompt, /policy_prompt = harness_policy\/programming/);
  assert.match(programmingPrompt, /快速定位问题与影响范围/);
  assert.match(programmingPrompt, /复用现有结构、方法、字段/);
  assert.match(programmingPrompt, /面对复杂任务时/);
  assert.match(programmingPrompt, /消除旧入口、旧字段、兼容分支、重复存储和废弃逻辑等残留/);
  assert.match(programmingPrompt, /连续多个最小切片推进任务/);
  assert.match(programmingPrompt, /不是临时补丁式绕过/);
  assert.match(programmingPrompt, /不只做一个小改就停下/);
  assert.match(programmingPrompt, /相关测试、lint、类型检查或构建/);

  const defaultPrompt = await buildInjectedPolicy();
  assert.match(defaultPrompt, /scenario = general/);
    assert.match(defaultPrompt, /policy_prompt = harness_policy\/general/);
  assert.match(defaultPrompt, /用户隔离/);
  assert.doesNotMatch(defaultPrompt, new RegExp("执行" + "优先|" + "风险" + "优先|risk first", "i"));
  assert.match(defaultPrompt, /最小切片/);
});

test("harness policy prompt is not reinjected during stopped snapshot resume initialization", async () => {
  const existingPolicy = [
    "[HARNESS_POLICY_SELECTION]",
    "scenario = programming",
    "policy_prompt = harness_policy/programming",
    "[/HARNESS_POLICY_SELECTION]",
  ].join("\n");
  const ctx = {
    turn: 1,
    messages: [
      { role: "system", content: existingPolicy },
      { role: "user", content: "ID: dialog-a\nPATCH: continue" },
    ],
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            resumeFromStoppedSnapshot: true,
            agentLifecycleState: "resume_initializing",
            agentLifecycleInitialState: "resume_initializing",
          },
        },
      },
    },
  };

  await injectPrompt("before_llm_call", ctx, {
    enabled: true,
    promptPolicy: true,
    promptText: "",
    promptPriority: 80,
    writePrompts: false,
  });

  const policyMessages = ctx.messages.filter((message = {}) =>
    String(message.content || "").includes("HARNESS_POLICY_SELECTION"),
  );
  assert.equal(policyMessages.length, 1);
  assert.equal(policyMessages[0].content, existingPolicy);
});

test("harness policy prompt is not reinjected after stopped snapshot blocks are restored", async () => {
  const existingPolicy = [
    "[HARNESS_POLICY_SELECTION]",
    "scenario = programming",
    "policy_prompt = harness_policy/programming",
    "[/HARNESS_POLICY_SELECTION]",
  ].join("\n");
  const ctx = {
    turn: 2,
    messages: [
      { role: "system", content: existingPolicy },
      { role: "user", content: "继续" },
    ],
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            resumeFromStoppedSnapshot: true,
            agentLifecycleState: "running",
            resumedStoppedSnapshotIdentity: {
              dialogProcessId: "dp-stopped",
              turnScopeId: "turn-stopped",
            },
            resumedStoppedSnapshotMessageBlocks: {
              system: [{ role: "system", content: existingPolicy }],
              history: [],
              incremental: [],
            },
          },
        },
      },
    },
  };

  await injectPrompt("before_llm_call", ctx, {
    enabled: true,
    promptPolicy: true,
    promptText: "",
    promptPriority: 80,
    writePrompts: false,
  });

  const policyMessages = ctx.messages.filter((message = {}) =>
    String(message.content || "").includes("HARNESS_POLICY_SELECTION"),
  );
  assert.equal(policyMessages.length, 1);
  assert.equal(policyMessages[0].content, existingPolicy);
});

test("harness policy prompt is injected for normal first llm call", async () => {
  const ctx = {
    turn: 1,
    messages: [{ role: "user", content: "hello" }],
    agentContext: {
      execution: {
        controllers: {
          runtime: {
            resumeFromStoppedSnapshot: false,
            agentLifecycleState: "initializing",
          },
        },
      },
    },
  };

  await injectPrompt("before_llm_call", ctx, {
    enabled: true,
    promptPolicy: true,
    promptText: "",
    promptPriority: 80,
    writePrompts: false,
  });

  assert.equal(
    ctx.messages.some((message = {}) => String(message.content || "").includes("HARNESS_POLICY_SELECTION")),
    true,
  );
});


test("harness policy selection resolver maps scenario to i18n keys", () => {
  assert.deepEqual(
    resolvePolicyPromptSelection({}, {}).policyPromptId,
    "harness_policy/general",
  );
  assert.equal(
    resolvePolicyPromptSelection({}, {}).i18nKey,
    "harnessPolicyGeneralPrompt",
  );
  assert.equal(
    resolvePolicyPromptSelection({ runConfig: { scenario: "text" } }, {}).i18nKey,
    "harnessPolicyTextPrompt",
  );
  assert.equal(
    resolvePolicyPromptSelection({ runConfig: { scenario: "programming" } }, {}).i18nKey,
    "harnessPolicyProgrammingPrompt",
  );
});

