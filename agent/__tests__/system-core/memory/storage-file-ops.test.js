import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

const FILE_OPS_MODULE_URL = new URL(
  "../../../src/system-core/memory/storage/file-ops.js",
  import.meta.url,
);

function buildFreshModuleUrl() {
  const url = new URL(FILE_OPS_MODULE_URL);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return String(url);
}

test("splitTextIntoChunks splits by max chars", async () => {
  const { splitTextIntoChunks } = await import(buildFreshModuleUrl());
  const chunks = splitTextIntoChunks("abcdefghij", 4);
  assert.deepEqual(chunks, ["abcd", "efgh", "ij"]);
});

test("writeText/readText/appendText supports split part files", async () => {
  const prev = process.env.NOOBOT_MEMORY_FILE_SPLIT_MAX_CHARS;
  process.env.NOOBOT_MEMORY_FILE_SPLIT_MAX_CHARS = "10";
  try {
    const { writeText, appendText, readText } = await import(buildFreshModuleUrl());
    const root = await mkdtemp(path.join(tmpdir(), "noobot-memory-split-"));
    const filePath = path.join(root, "memory.md");

    await writeText(filePath, "x".repeat(23));
    const filesAfterWrite = (await readdir(root)).sort();
    assert.deepEqual(filesAfterWrite, ["memory.md", "memory.md.part1", "memory.md.part2"]);
    assert.equal(await readText(filePath, ""), "x".repeat(23));

    await appendText(filePath, "y".repeat(7));
    const filesAfterAppend = (await readdir(root)).sort();
    assert.deepEqual(filesAfterAppend, [
      "memory.md",
      "memory.md.part1",
      "memory.md.part2",
    ]);
    assert.equal(await readText(filePath, ""), "x".repeat(23) + "y".repeat(7));
  } finally {
    if (prev === undefined) delete process.env.NOOBOT_MEMORY_FILE_SPLIT_MAX_CHARS;
    else process.env.NOOBOT_MEMORY_FILE_SPLIT_MAX_CHARS = prev;
  }
});
