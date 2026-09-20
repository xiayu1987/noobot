/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const KIB = 1024;

function javascriptChunks(bundle = {}) {
  return Object.values(bundle).filter((output) => output?.type === "chunk");
}

function collectInitialChunkNames(chunks = []) {
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const initial = new Set(chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName));
  const pending = [...initial];
  while (pending.length) {
    const fileName = pending.pop();
    const chunk = byFileName.get(fileName);
    for (const importedName of chunk?.imports || []) {
      if (!byFileName.has(importedName) || initial.has(importedName)) continue;
      initial.add(importedName);
      pending.push(importedName);
    }
  }
  return initial;
}

function chunkBytes(chunk = {}) {
  return Buffer.byteLength(String(chunk.code || ""), "utf8");
}

export function assertChunkBudgets(
  bundle,
  { initialLimitKiB = 500, deferredLimitKiB = 3000 } = {},
) {
  const chunks = javascriptChunks(bundle);
  const initialChunks = collectInitialChunkNames(chunks);
  const violations = [];
  for (const chunk of chunks) {
    const initial = initialChunks.has(chunk.fileName);
    const limitKiB = initial ? initialLimitKiB : deferredLimitKiB;
    const size = chunkBytes(chunk);
    if (size <= limitKiB * KIB) continue;
    violations.push(
      `${chunk.fileName}: ${(size / KIB).toFixed(2)} KiB exceeds ${initial ? "initial" : "deferred"} limit ${limitKiB} KiB`,
    );
  }
  if (violations.length) {
    throw new Error(`JavaScript chunk budget exceeded:\n${violations.join("\n")}`);
  }
}

export function createChunkBudgetPlugin(options = {}) {
  return {
    name: "noobot-chunk-budget",
    generateBundle(_outputOptions, bundle) {
      assertChunkBudgets(bundle, options);
    },
  };
}
