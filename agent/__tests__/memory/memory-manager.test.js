/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { renderDefaultExperienceModelText } from "@noobot/memory-protocol/experience/default-model";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";

import { MemoryManager } from "../../src/memory/index.js";
import { writeSessionArtifact } from "../../src/session/session-artifact-store.js";

function createMemoryConfig(workspaceRoot, alias = "mock-memory-model") {
  return {
    workspaceRoot,
    defaultProvider: alias,
    providers: {
      [alias]: {
        alias,
        model: alias,
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high"],
        providerId: alias,
        adapterId: "openai-compatible",
        api_key: "test-key",
      },
    },
  };
}

function createModelPortFactory(outputs, calls = []) {
  const queue = [...outputs];
  return ({ modelSpec }) => ({
    async invoke(request) {
      calls.push({ modelSpec, request });
      const next = queue.shift();
      return typeof next === "function"
        ? next(request)
        : { output: { text: String(next || ""), toolCalls: [] } };
    },
  });
}

async function waitFor(asyncGetter, { retries = 20, intervalMs = 20 } = {}) {
  let lastError = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await asyncGetter();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError || new Error("waitFor failed");
}

const EMPTY_LONG_MEMORY_DOCUMENT = "NOOBOT_LONG_MEMORY/1\n";

async function createLongMemoryUserRoot() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  await writeFile(path.join(userRoot, "memory/long-memory.md"), EMPTY_LONG_MEMORY_DOCUMENT);
  await writeFile(
    path.join(userRoot, "memory/experience-model.md"),
    renderDefaultExperienceModelText(),
  );
  return { workspaceRoot, userId, userRoot };
}

function readLongMemoryDoc(userRoot) {
  return readFile(path.join(userRoot, "memory/long-memory.md"), "utf8");
}

async function writeShortMemoryItems(userRoot, count = 30) {
  const shortItems = Array.from({ length: count }, (_, index) => ({
    records: [{ role: "user", content: `用户消息 ${index + 1}` }],
    createdAt: new Date(2026, 0, index + 1).toISOString(),
  }));
  await writeFile(
    path.join(userRoot, "memory/short-memory.json"),
    JSON.stringify({ items: shortItems }, null, 2),
  );
}

test("readLongMemory renders the field protocol body without the document header", async () => {
  const { workspaceRoot, userId, userRoot } = await createLongMemoryUserRoot();
  await writeFile(
    path.join(userRoot, "memory/long-memory.md"),
    "NOOBOT_LONG_MEMORY/1\n\npersonal_info.occupation：工程师\n",
  );
  const service = new MemoryManager({ workspaceRoot });
  assert.equal(await service.readLongMemory({ userId }), "personal_info.occupation：工程师");
});

test("readLongMemory rejects a document whose protocol header does not match", async () => {
  const { workspaceRoot, userId, userRoot } = await createLongMemoryUserRoot();
  await writeFile(path.join(userRoot, "memory/long-memory.md"), "1. legacy numbered memory\n");
  const service = new MemoryManager({ workspaceRoot });
  await assert.rejects(service.readLongMemory({ userId }), {
    code: "MEMORY_DOCUMENT_HEADER_INVALID",
  });
});

test("long memory update overwrites single fields and edits list fields by snapshot index", async () => {
  const { workspaceRoot, userRoot } = await createLongMemoryUserRoot();
  await writeFile(
    path.join(userRoot, "memory/long-memory.md"),
    [
      "NOOBOT_LONG_MEMORY/1",
      "",
      "personality.decision_style：先调研",
      "",
      "interests.hobbies：",
      "1. 跑步",
      "2. 阅读",
      "3. 摄影",
      "",
    ].join("\n"),
  );
  const service = new MemoryManager({ workspaceRoot });
  const state = await service.longMemory.readState(userRoot);
  const result = await service.longMemory.update(
    userRoot,
    state,
    [
      "UPDATE personality.decision_style：先验证再决定",
      "ADD interests.hobbies：围棋",
      "UPDATE interests.hobbies 3：风光摄影",
      "DELETE interests.hobbies 1",
    ].join("\n"),
  );
  assert.deepEqual(result, { changed: true });
  assert.equal(
    await readLongMemoryDoc(userRoot),
    [
      "NOOBOT_LONG_MEMORY/1",
      "",
      "interests.hobbies：",
      "1. 阅读",
      "2. 风光摄影",
      "3. 围棋",
      "",
      "personality.decision_style：先验证再决定",
      "",
    ].join("\n"),
  );
});

test("long memory update rejects the whole batch when a list exceeds its limit", async () => {
  const { workspaceRoot, userRoot } = await createLongMemoryUserRoot();
  const service = new MemoryManager({ workspaceRoot });
  const state = await service.longMemory.readState(userRoot);
  const patch = ["UPDATE personal_info.occupation：工程师"]
    .concat(Array.from({ length: 6 }, (_, index) => `ADD interests.hobbies：爱好${index + 1}`))
    .join("\n");
  await assert.rejects(service.longMemory.update(userRoot, state, patch), {
    code: "LONG_MEMORY_PATCH_INVALID",
  });
  assert.equal(await readLongMemoryDoc(userRoot), EMPTY_LONG_MEMORY_DOCUMENT);
});

test("long memory update rejects commands that do not match the field kind", async () => {
  const { workspaceRoot, userRoot } = await createLongMemoryUserRoot();
  const service = new MemoryManager({ workspaceRoot });
  const state = await service.longMemory.readState(userRoot);
  for (const line of [
    "ADD personal_info.occupation：工程师",
    "UPDATE interests.hobbies：跑步",
    "DELETE personal_info.occupation 1",
    "UPDATE unknown.field：值",
    "UPDATE L[1] 旧协议",
  ]) {
    await assert.rejects(service.longMemory.update(userRoot, state, line), {
      code: "LONG_MEMORY_PATCH_INVALID",
    });
  }
});

test("long memory update treats an equivalent patch as unchanged", async () => {
  const { workspaceRoot, userRoot } = await createLongMemoryUserRoot();
  const document = "NOOBOT_LONG_MEMORY/1\n\npersonal_info.occupation：工程师\n";
  await writeFile(path.join(userRoot, "memory/long-memory.md"), document);
  const service = new MemoryManager({ workspaceRoot });
  const state = await service.longMemory.readState(userRoot);
  const result = await service.longMemory.update(
    userRoot,
    state,
    "UPDATE personal_info.occupation：工程师",
  );
  assert.deepEqual(result, { changed: false });
  assert.equal(await readLongMemoryDoc(userRoot), document);
});

test("long memory follows the user field protocol and keeps removed fields", async () => {
  const { workspaceRoot, userRoot } = await createLongMemoryUserRoot();
  await writeFile(
    path.join(userRoot, "memory/long-memory-model.md"),
    [
      "NOOBOT_LONG_MEMORY_MODEL/1",
      "",
      "personal_info.occupation | single | 职业",
      "work.tech_stack | list:3 | 常用技术栈",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(userRoot, "memory/long-memory.md"),
    "NOOBOT_LONG_MEMORY/1\n\ninterests.hobbies：\n1. 跑步\n",
  );
  const service = new MemoryManager({ workspaceRoot });
  const state = await service.longMemory.readState(userRoot);
  assert.equal(state.modelError, null);
  assert.deepEqual(
    state.model.fields.map((field) => field.key),
    ["personal_info.occupation", "work.tech_stack"],
  );
  assert.deepEqual([...state.orphans], [["interests.hobbies", ["跑步"]]]);
  await assert.rejects(service.longMemory.update(userRoot, state, "ADD interests.hobbies：围棋"), {
    code: "LONG_MEMORY_PATCH_INVALID",
  });
  const result = await service.longMemory.update(userRoot, state, "ADD work.tech_stack：Node.js");
  assert.deepEqual(result, { changed: true });
  assert.equal(
    await readLongMemoryDoc(userRoot),
    "NOOBOT_LONG_MEMORY/1\n\nwork.tech_stack：\n1. Node.js\n\ninterests.hobbies：\n1. 跑步\n",
  );
});

test("an invalid user field protocol falls back to the built-in fields", async () => {
  const { workspaceRoot, userRoot } = await createLongMemoryUserRoot();
  await writeFile(
    path.join(userRoot, "memory/long-memory-model.md"),
    "NOOBOT_LONG_MEMORY_MODEL/1\n\nbroken line\n",
  );
  const service = new MemoryManager({ workspaceRoot });
  const state = await service.longMemory.readState(userRoot);
  assert.equal(state.modelError?.code, "LONG_MEMORY_MODEL_INVALID");
  assert.ok(state.model.byKey.has("interests.hobbies"));
});

test("maybeSummarize applies the field patch from ModelPort text output", async () => {
  const { workspaceRoot, userId, userRoot } = await createLongMemoryUserRoot();
  await writeShortMemoryItems(userRoot);
  const calls = [];
  const service = new MemoryManager(createMemoryConfig(workspaceRoot), {
    createModelPort: createModelPortFactory(
      ["UPDATE history_preferences.preferred_conversation_style：简洁直接", ""],
      calls,
    ),
  });
  const stageErrors = [];
  await service.maybeSummarize({
    userId,
    userConfig: {},
    onStageError: (e) => stageErrors.push(e),
  });
  assert.deepEqual(stageErrors, []);
  const prompt = calls[0].request.messages[1].content;
  assert.match(prompt, /interests\.hobbies \| list:5 \(0\/5\)/);
  assert.match(prompt, /UPDATE <single\.field>：<value>/);
  assert.match(
    await readLongMemoryDoc(userRoot),
    /history_preferences\.preferred_conversation_style：简洁直接/,
  );
});

test("maybeSummarize uses configured memoryModel for long memory and experience processing", async () => {
  const { workspaceRoot, userId, userRoot } = await createLongMemoryUserRoot();
  await writeShortMemoryItems(userRoot);
  const calls = [];
  const globalConfig = createMemoryConfig(workspaceRoot, "default-memory-model");
  globalConfig.providers["selected-memory-model"] = {
    alias: "selected-memory-model",
    model: "selected-memory-model",
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high"],
    providerId: "selected-memory-model",
    adapterId: "openai-compatible",
    api_key: "test-key",
  };
  const service = new MemoryManager(globalConfig, {
    createModelPort: createModelPortFactory(
      [
        "ADD history_preferences.common_topics：专用记忆模型",
        'ADD D[1] domain="模型选择" new=true experiences="记忆处理使用专用模型" lessons="不要复用主流程模型假设"',
      ],
      calls,
    ),
  });
  await service.maybeSummarize({
    userId,
    userConfig: { memoryModel: "selected-memory-model" },
    onStageError: ({ error }) => {
      throw error;
    },
  });

  assert.equal(calls.length >= 2, true);
  assert.equal(
    calls.every((call) => call.modelSpec.alias === "selected-memory-model"),
    true,
  );
  assert.deepEqual(
    calls.slice(0, 2).map((call) => call.request.invocation.flow),
    ["memory.summary", "memory.experience.daily"],
  );
  for (const call of calls) {
    assert.deepEqual(
      call.request.messages.map((message) => message.role),
      ["system", "user"],
    );
    assert.match(call.request.messages[0].content, /memory processor|记忆处理器/i);
  }
  assert.match(await readLongMemoryDoc(userRoot), /1\. 专用记忆模型/);
  const summaryRoot = path.join(userRoot, "memory/daily_summary");
  const dateDirs = await readdir(summaryRoot);
  assert.equal(dateDirs.length, 1);
  const files = await readdir(path.join(summaryRoot, dateDirs[0]));
  assert.deepEqual(files, ["模型选择.md"]);
});

test("maybeSummarize records an invalid long memory patch, continues later stages and clears short memory", async () => {
  const { workspaceRoot, userId, userRoot } = await createLongMemoryUserRoot();
  await writeShortMemoryItems(userRoot);
  const calls = [];
  const service = new MemoryManager(createMemoryConfig(workspaceRoot), {
    createModelPort: createModelPortFactory(
      [
        "这是不符合字段补丁协议的文本",
        'ADD D[1] domain="记忆容错" new=true experiences="长期记忆失败不中断" lessons="失败要记录"',
      ],
      calls,
    ),
  });
  const stageErrors = [];
  await service.maybeSummarize({
    userId,
    userConfig: {},
    onStageError: (entry) => stageErrors.push(entry),
  });
  assert.deepEqual(
    stageErrors.map((entry) => [entry.stage, entry.error?.code]),
    [["long_memory", "LONG_MEMORY_PATCH_INVALID"]],
  );
  assert.deepEqual(
    calls.slice(0, 2).map((call) => call.request.invocation.flow),
    ["memory.summary", "memory.experience.daily"],
  );
  const dateDirs = await readdir(path.join(userRoot, "memory/daily_summary"));
  assert.equal(dateDirs.length, 1);
  const shortDoc = JSON.parse(
    await readFile(path.join(userRoot, "memory/short-memory.json"), "utf8"),
  );
  assert.equal(shortDoc.items.length, 0);
  assert.equal(await readLongMemoryDoc(userRoot), EMPTY_LONG_MEMORY_DOCUMENT);
});

test("maybeSummarize rethrows abort errors from a stage", async () => {
  const { workspaceRoot, userId, userRoot } = await createLongMemoryUserRoot();
  await writeShortMemoryItems(userRoot);
  const controller = new AbortController();
  const service = new MemoryManager(createMemoryConfig(workspaceRoot), {
    createModelPort: () => ({
      async invoke() {
        controller.abort();
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    }),
  });
  const stageErrors = [];
  await assert.rejects(
    service.maybeSummarize({
      userId,
      userConfig: {},
      abortSignal: controller.signal,
      onStageError: (entry) => stageErrors.push(entry),
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(stageErrors, []);
  const shortDoc = JSON.parse(
    await readFile(path.join(userRoot, "memory/short-memory.json"), "utf8"),
  );
  assert.equal(shortDoc.items.length, 30);
});

test("append daily domain results writes per-domain md and metadata", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });

  const service = new MemoryManager({ workspaceRoot });
  const ok = await service.experience.appendDailyDomainResults({
    basePath: userRoot,
    results: [
      {
        domain: "前端/开发:基础",
        new: true,
        experiences: ["切换模型后需验证下一轮 provider 生效。"],
        lessons: ["避免把系统保留字符写入文件名。"],
      },
    ],
    createdAt: "2026-05-13T10:00:00.000Z",
  });
  assert.equal(ok, true);

  const dayDir = path.join(userRoot, "memory/daily_summary/2026-05-13");
  const files = await readdir(dayDir);
  assert.deepEqual(files, ["前端_开发_基础.md"]);

  const content = await readFile(path.join(dayDir, "前端_开发_基础.md"), "utf8");
  assert.match(content, /经验：/);
  assert.match(content, /教训：/);

  const metadata = await readFile(path.join(userRoot, "memory/experience/metadata.md"), "utf8");
  assert.match(metadata, /DOMAIN:\s*前端_开发_基础/);
});

test("custom experience fields from the user protocol drive daily parsing and rendering", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userRoot = path.join(workspaceRoot, "primary-user");
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  await writeFile(
    path.join(userRoot, "memory/experience-fields.md"),
    [
      "NOOBOT_EXPERIENCE_FIELDS/1",
      "",
      "STAGE: daily",
      "- experiences | 经验 | 做成了什么",
      "- tools | 工具 | 用到的关键工具",
      "",
      "STAGE: weekly",
      "- experiences | 经验 | 本周有效做法",
      "",
      "STAGE: monthly",
      "- patterns | 规律 | 规律",
      "",
      "STAGE: yearly",
      "- principles | 原则 | 原则",
      "",
    ].join("\n"),
  );

  const service = new MemoryManager({ workspaceRoot });
  const fields = await service.experience.readExperienceFields(userRoot);
  const results = service.experience.parseDaily(
    'ADD D[1] domain="工程/调试" new=true experiences="先复现再修" tools="node --test"',
    { basePath: userRoot, fields },
  );
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].tools, ["node --test"]);

  const ok = await service.experience.appendDailyDomainResults({
    basePath: userRoot,
    results,
    createdAt: "2026-05-13T10:00:00.000Z",
    fields,
  });
  assert.equal(ok, true);
  const content = await readFile(
    path.join(userRoot, "memory/daily_summary/2026-05-13/工程_调试.md"),
    "utf8",
  );
  assert.match(content, /工具：/);
  assert.match(content, /node --test/);
  assert.doesNotMatch(content, /教训：/);
});

test("parse daily experience output supports ID+PATCH protocol", () => {
  const service = new MemoryManager({ workspaceRoot: "/tmp/workspace" });
  const items = service.experience.parseDaily(
    ['ADD D[1] domain="测试/域" new=true experiences="经验1 || 经验1" lessons="教训1"'].join("\n"),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].domain, "测试_域");
  assert.deepEqual(items[0].experiences, ["经验1"]);
  assert.deepEqual(items[0].lessons, ["教训1"]);
});

test("logs raw model output when daily patch parse fails", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });

  const service = new MemoryManager({ workspaceRoot });
  const items = service.experience.parseDaily("这是不符合协议的内容", { basePath: userRoot });
  assert.deepEqual(items, []);

  const logContent = await waitFor(() =>
    readFile(path.join(userRoot, "memory/experience/_parse-error.log"), "utf8"),
  );
  assert.match(logContent, /stage=daily_experience/);
  assert.match(logContent, /error=/);
  assert.match(logContent, /raw:/);
});

test("captureSessionToShortMemory skips injected messages", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  const parentSessionId = ` ${"p".repeat(220)} `;
  const normalizedParentSessionId = "p".repeat(200);
  await mkdir(path.join(userRoot, "runtime/session", normalizedParentSessionId, "s1"), {
    recursive: true,
  });
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  await writeSessionArtifact({
    sessionDir: path.join(userRoot, "runtime/session", normalizedParentSessionId, "s1"),
    sessionPayload: {
      sessionId: "s1",
      messages: [
        {
          messageUid: "sm_memory_user",
          role: "user",
          content: "真实用户消息",
          dialogProcessId: "d1",
          turnScopeId: "t1",
        },
        {
          messageUid: "sm_memory_injected",
          role: "user",
          content: "注入消息",
          dialogProcessId: "d1",
          turnScopeId: "t1",
          injectedMessage: true,
          injectedBy: "agentPlugin",
        },
        ...[
          CONTEXT_INJECTED_MESSAGE_TYPE.TASK_CHECK_PROMPT,
          CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_PROMPT,
          CONTEXT_INJECTED_MESSAGE_TYPE.HELP_TOOL_LOOP_PROMPT,
        ].map((internalType, index) => ({
          messageUid: `sm_memory_control_${index}`,
          role: "user",
          type: "context_control",
          content: "已达到周期任务检查阈值。",
          dialogProcessId: "d1",
          turnScopeId: "t1",
          injectedMessage: true,
          injectedMessageType: internalType,
          noobotInternalMessageType: internalType,
        })),
      ],
    },
  });

  const service = new MemoryManager({ workspaceRoot });
  const ok = await service.captureSessionToShortMemory({
    userId,
    sessionId: "s1",
    parentSessionId,
  });
  assert.equal(ok, true);
  const shortDoc = JSON.parse(
    await readFile(path.join(userRoot, "memory/short-memory.json"), "utf8"),
  );
  const records = shortDoc?.items?.[0]?.records || [];
  assert.equal(shortDoc?.items?.[0]?.sessionId, "s1");
  assert.equal(shortDoc?.items?.[0]?.parentSessionId, normalizedParentSessionId);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.content, "真实用户消息");
});

test("deleteSessionMemoryBySessionIds removes only memory with an explicit session identity", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  await writeFile(
    path.join(userRoot, "memory/short-memory.json"),
    JSON.stringify({
      items: [
        { sessionId: "s-delete", parentSessionId: "", records: [], createdAt: "2026-01-01" },
        { sessionId: "node-1", parentSessionId: "s-delete", records: [], createdAt: "2026-01-02" },
        { sessionId: "s-keep", parentSessionId: "", records: [], createdAt: "2026-01-03" },
        { records: [], createdAt: "2026-01-04" },
      ],
    }),
  );

  const service = new MemoryManager({ workspaceRoot });
  const result = await service.deleteSessionMemoryBySessionIds({
    userId,
    sessionIds: ["s-delete"],
  });

  assert.equal(result.deletedCount, 2);
  const shortDoc = JSON.parse(
    await readFile(path.join(userRoot, "memory/short-memory.json"), "utf8"),
  );
  assert.deepEqual(
    shortDoc.items.map((item) => item.sessionId || ""),
    ["s-keep", ""],
  );
});
