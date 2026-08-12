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
        format: "openai_compatible",
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

test("readLongMemory only returns static long memory content", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  await writeFile(path.join(userRoot, "memory/long-memory.md"), "1. static long memory\n");

  const service = new MemoryManager({ workspaceRoot });
  const content = await service.readLongMemory({ userId });
  assert.equal(content, "1. static long memory");
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
        domain_name: "前端/开发:基础",
        is_new_domain: true,
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

test("parse daily experience output supports ID+PATCH protocol", () => {
  const service = new MemoryManager({ workspaceRoot: "/tmp/workspace" });
  const items = service.experience.parseDaily(
    ['ADD D[1] domain="测试/域" new=true experiences="经验1 || 经验1" lessons="教训1"'].join("\n"),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].domain_name, "测试_域");
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

test("long memory update applies L/M patch commands", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  await writeFile(path.join(userRoot, "memory/long-memory.md"), "1. 旧偏好\n");

  const service = new MemoryManager({ workspaceRoot });
  const changed = await service.longMemory.update(
    userRoot,
    [
      "UPDATE L[1] 喜欢结构化输出",
      "ADD L[2] 倾向先验证再实现",
      'ADD M[1] key="communication_style" value="concise"',
    ].join("\n"),
  );
  assert.equal(changed, true);

  const longMemoryDoc = await readFile(path.join(userRoot, "memory/long-memory.md"), "utf8");
  assert.match(String(longMemoryDoc || ""), /1\. 喜欢结构化输出/);
  assert.match(String(longMemoryDoc || ""), /2\. 倾向先验证再实现/);

  const metadataDoc = await readFile(path.join(userRoot, "memory/long-memory/metadata.md"), "utf8");
  assert.match(metadataDoc, /M1 key="communication_style" value="concise"/);
});

test("long memory update materializes metadata-only patches into long-memory.md", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });

  const service = new MemoryManager({ workspaceRoot });
  const changed = await service.longMemory.update(
    userRoot,
    [
      'ADD M[1] key="interests" value="工具测试与验证"',
      'ADD M[2] key="personality" value="偏好先复现再修复"',
    ].join("\n"),
  );
  assert.equal(changed, true);

  const longMemoryDoc = await readFile(path.join(userRoot, "memory/long-memory.md"), "utf8");
  assert.match(String(longMemoryDoc || ""), /1\. interests: 工具测试与验证/);
  assert.match(String(longMemoryDoc || ""), /2\. personality: 偏好先复现再修复/);

  const metadataDoc = await readFile(path.join(userRoot, "memory/long-memory/metadata.md"), "utf8");
  assert.match(metadataDoc, /M1 key="interests" value="工具测试与验证"/);
  assert.match(metadataDoc, /M2 key="personality" value="偏好先复现再修复"/);
});

test("maybeSummarize consumes normalized ModelPort text output", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });

  const shortItems = Array.from({ length: 30 }, (_, index) => ({
    records: [
      { role: "user", content: `用户消息 ${index + 1}` },
      { role: "assistant", content: `助手回复 ${index + 1}` },
    ],
    createdAt: new Date(2026, 0, index + 1).toISOString(),
  }));
  await writeFile(
    path.join(userRoot, "memory/short-memory.json"),
    JSON.stringify({ items: shortItems }, null, 2),
  );

  const service = new MemoryManager(createMemoryConfig(workspaceRoot), {
    createModelPort: createModelPortFactory([
      [
        "UPDATE L[1] 喜欢结构化输出",
        "ADD L[2] 倾向先验证再实现",
        'ADD M[1] key="communication_style" value="concise"',
      ].join("\n"),
      "",
    ]),
  });
  await service.maybeSummarize({ userId, userConfig: {} });

  const longMemoryDoc = await readFile(path.join(userRoot, "memory/long-memory.md"), "utf8");
  assert.match(String(longMemoryDoc || ""), /1\. 喜欢结构化输出/);
  assert.match(String(longMemoryDoc || ""), /2\. 倾向先验证再实现/);

  const metadataDoc = await readFile(path.join(userRoot, "memory/long-memory/metadata.md"), "utf8");
  assert.match(metadataDoc, /M1 key="communication_style" value="concise"/);
});

test("maybeSummarize uses configured memoryModel for long memory and experience processing", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  const shortItems = Array.from({ length: 30 }, (_, index) => ({
    records: [{ role: "user", content: `用户消息 ${index + 1}` }],
    createdAt: new Date(2026, 0, index + 1).toISOString(),
  }));
  await writeFile(
    path.join(userRoot, "memory/short-memory.json"),
    JSON.stringify({ items: shortItems }, null, 2),
  );

  const calls = [];
  const globalConfig = createMemoryConfig(workspaceRoot, "default-memory-model");
  globalConfig.providers["selected-memory-model"] = {
    alias: "selected-memory-model",
    model: "selected-memory-model",
    format: "openai_compatible",
    providerId: "selected-memory-model",
    adapterId: "openai-compatible",
    api_key: "test-key",
  };
  const service = new MemoryManager(globalConfig, {
    createModelPort: createModelPortFactory(
      [
        "ADD L[1] 使用专用记忆模型",
        'ADD D[1] domain="模型选择" new=true experiences="记忆处理使用专用模型" lessons="不要复用主流程模型假设"',
      ],
      calls,
    ),
  });
  await service.maybeSummarize({
    userId,
    userConfig: { memoryModel: "selected-memory-model" },
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
  const longMemoryDoc = await readFile(path.join(userRoot, "memory/long-memory.md"), "utf8");
  assert.match(longMemoryDoc, /使用专用记忆模型/);
  const summaryRoot = path.join(userRoot, "memory/daily_summary");
  const dateDirs = await readdir(summaryRoot);
  assert.equal(dateDirs.length, 1);
  const files = await readdir(path.join(summaryRoot, dateDirs[0]));
  assert.deepEqual(files, ["模型选择.md"]);
});

test("maybeSummarize does not clear short memory for unreadable long memory patch", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  const shortItems = Array.from({ length: 30 }, (_, index) => ({
    records: [{ role: "user", content: `用户消息 ${index + 1}` }],
    createdAt: new Date(2026, 0, index + 1).toISOString(),
  }));
  await writeFile(
    path.join(userRoot, "memory/short-memory.json"),
    JSON.stringify({ items: shortItems }, null, 2),
  );
  const service = new MemoryManager(createMemoryConfig(workspaceRoot), {
    createModelPort: createModelPortFactory([
      "这是稳定但不符合 ID+PATCH 协议的文本",
      "这是稳定但不符合 ID+PATCH 协议的文本",
    ]),
  });
  await service.maybeSummarize({ userId, userConfig: {} });
  const shortDoc = JSON.parse(
    await readFile(path.join(userRoot, "memory/short-memory.json"), "utf8"),
  );
  assert.equal(shortDoc.items.length, 30);
  await assert.rejects(readFile(path.join(userRoot, "memory/long-memory.md"), "utf8"));
});

test("long memory update treats equivalent legal patch as unchanged", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory/long-memory"), { recursive: true });
  await writeFile(path.join(userRoot, "memory/long-memory.md"), "1. 喜欢结构化输出\n");
  await writeFile(
    path.join(userRoot, "memory/long-memory/metadata.md"),
    'M1 key="communication_style" value="concise"\n',
  );
  const service = new MemoryManager({ workspaceRoot });
  const changed = await service.longMemory.update(
    userRoot,
    ["UPDATE L[1] 喜欢结构化输出", 'UPDATE M[1] key="communication_style" value="concise"'].join(
      "\n",
    ),
  );
  assert.equal(changed, false);
});

test("long memory update accepts colon separator in stable text protocol", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  const service = new MemoryManager({ workspaceRoot });
  const changed = await service.longMemory.update(
    userRoot,
    ["ADD L[1]: 喜欢先复现再修复", 'ADD M[1]： key="workflow" value="先复现再修复"'].join("\n"),
  );
  assert.equal(changed, true);
  const longMemoryDoc = await readFile(path.join(userRoot, "memory/long-memory.md"), "utf8");
  assert.match(longMemoryDoc, /1\. 喜欢先复现再修复/);
});

test("captureSessionToShortMemory skips injected messages", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "primary-user";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "runtime/session/s1"), { recursive: true });
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  await writeSessionArtifact({
    sessionDir: path.join(userRoot, "runtime/session/s1"),
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
      ],
    },
  });

  const service = new MemoryManager({ workspaceRoot });
  const ok = await service.captureSessionToShortMemory({
    userId,
    sessionId: "s1",
  });
  assert.equal(ok, true);
  const shortDoc = JSON.parse(
    await readFile(path.join(userRoot, "memory/short-memory.json"), "utf8"),
  );
  const records = shortDoc?.items?.[0]?.records || [];
  assert.equal(records.length, 1);
  assert.equal(records[0]?.content, "真实用户消息");
});
