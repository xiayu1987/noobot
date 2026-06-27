import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

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
  const { writeText, appendText, readText } = await import(buildFreshModuleUrl());
  const root = await mkdtemp(path.join(tmpdir(), "noobot-memory-split-"));
  const filePath = path.join(root, "memory.md");
  const splitMaxChars = LENGTH_THRESHOLDS.memory.fileSplitChars;
  const initialText = "x".repeat(splitMaxChars * 2 + 3);
  const appendedText = "y".repeat(7);

  await writeText(filePath, initialText);
  const filesAfterWrite = (await readdir(root)).sort();
  assert.deepEqual(filesAfterWrite, ["memory.md", "memory.md.part1", "memory.md.part2"]);
  assert.equal(await readText(filePath, ""), initialText);

  await appendText(filePath, appendedText);
  const filesAfterAppend = (await readdir(root)).sort();
  assert.deepEqual(filesAfterAppend, [
    "memory.md",
    "memory.md.part1",
    "memory.md.part2",
  ]);
  assert.equal(await readText(filePath, ""), initialText + appendedText);
});
