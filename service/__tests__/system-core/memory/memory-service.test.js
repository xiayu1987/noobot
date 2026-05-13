import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { MemoryService } from "../../../system-core/memory/index.js";

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

  const service = new MemoryService({ workspaceRoot });
  const content = await service.readLongMemory({ userId });
  assert.equal(content, "static long memory");
});

test("append experience lessons writes daily file and metadata", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "noobot-memory-"));
  const userId = "admin";
  const userRoot = path.join(workspaceRoot, userId);
  await mkdir(path.join(userRoot, "memory"), { recursive: true });

  const service = new MemoryService({ workspaceRoot });
  const ok = await service._appendExperienceLessons({
    basePath: userRoot,
    lessons: [
      {
        id: "l1",
        batchId: "b1",
        createdAt: "2026-05-13T10:00:00.000Z",
        category: "tooling",
        tags: ["回放", "模型切换"],
        summary: "切换模型后需验证下一轮 provider 生效。",
      },
    ],
    batchId: "b1",
    createdAt: "2026-05-13T10:00:00.000Z",
    sourceShortItems: [{ createdAt: "2026-05-13T09:59:00.000Z" }],
  });
  assert.equal(ok, true);

  const daily = JSON.parse(
    await readFile(
      path.join(userRoot, "memory/experience-lessons/2026-05-13.json"),
      "utf8",
    ),
  );
  assert.equal(daily.date, "2026-05-13");
  assert.equal(Array.isArray(daily.items), true);
  assert.equal(daily.items.length, 1);
  assert.deepEqual(daily.items[0].tags, ["回放", "模型切换"]);

  const metadata = JSON.parse(
    await readFile(
      path.join(userRoot, "memory/experience-lessons/metadata.json"),
      "utf8",
    ),
  );
  assert.equal(Array.isArray(metadata.batches), true);
  assert.equal(metadata.batches.length, 1);
  assert.equal(metadata.batches[0].file, "memory/experience-lessons/2026-05-13.json");
  assert.equal(metadata.batches[0].fileDir, "memory/experience-lessons");
  assert.deepEqual(metadata.batches[0].tags, ["回放", "模型切换"]);
});

test("parse experience lesson output normalizes tags/category/summary", () => {
  const service = new MemoryService({ workspaceRoot: "/tmp/workspace" });
  const lessons = service._parseExperienceLessonOutput(
    "```json\n{\"lessons\":[{\"category\":\"stability\",\"tags\":[\"回放\",\"回放\"],\"summary\":\"确认后刷新不应再弹窗\"}]}\n```",
    {
      batchId: "b1",
      createdAt: "2026-05-13T10:00:00.000Z",
    },
  );
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].batchId, "b1");
  assert.equal(lessons[0].category, "stability");
  assert.deepEqual(lessons[0].tags, ["回放"]);
  assert.equal(lessons[0].summary, "确认后刷新不应再弹窗");
});
