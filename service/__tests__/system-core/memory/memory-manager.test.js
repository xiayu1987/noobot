import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { MemoryManager } from "../../../system-core/memory/index.js";

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
  const userId = "admin";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });
  await writeFile(
    path.join(userRoot, "memory/long-memory.json"),
    JSON.stringify(
      {
        memory: "legacy long memory",
        staticMemory: "static long memory",
        experienceLessons: { shouldNotBeInContext: true },
      },
      null,
      2,
    ),
  );

  const service = new MemoryManager({ workspaceRoot });
  const content = await service.readLongMemory({ userId });
  assert.equal(content, "static long memory");
});

test("append daily domain results writes per-domain md and metadata", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "admin";
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

  const metadata = JSON.parse(
    await readFile(
      path.join(userRoot, "memory/experience/metadata.json"),
      "utf8",
    ),
  );
  assert.equal(Array.isArray(metadata.domainNames), true);
  assert.deepEqual(metadata.domainNames, ["前端_开发_基础"]);
});

test("parse daily experience output supports markdown fenced json", () => {
  const service = new MemoryManager({ workspaceRoot: "/tmp/workspace" });
  const items = service.experience.parseDaily(
    [
      "以下是结果：",
      "```json",
      '{"results":[{"domain_name":"测试/域","is_new_domain":true,"experiences":["经验1","经验1"],"lessons":["教训1"]}]}',
      "```",
      "请查收",
    ].join("\n"),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].domain_name, "测试_域");
  assert.deepEqual(items[0].experiences, ["经验1"]);
  assert.deepEqual(items[0].lessons, ["教训1"]);
});

test("logs raw model output when daily json parse fails", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "admin";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });

  const service = new MemoryManager({ workspaceRoot });
  const items = service.experience.parseDaily(
    "```json\n{\"results\":[{\"domain_name\":\"测试域\"}\n```",
    { basePath: userRoot },
  );
  assert.deepEqual(items, []);

  const logContent = await waitFor(() =>
    readFile(
      path.join(userRoot, "memory/experience/_parse-error.log"),
      "utf8",
    ),
  );
  assert.match(logContent, /stage=daily_experience/);
  assert.match(logContent, /error=/);
  assert.match(logContent, /raw:/);
});
