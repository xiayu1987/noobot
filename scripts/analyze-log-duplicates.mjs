#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/analyze-log-duplicates.mjs <logFile> [--top N] [--no-normalize]",
      "",
      "Example:",
      "  node scripts/analyze-log-duplicates.mjs .pm2/logs/noobot-service-out.log --top 20",
    ].join("\n"),
  );
}

function normalizeLine(line = "") {
  return String(line || "")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ISO_TS>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
    .replace(/\b\d{8,}\b/g, "<BIG_NUM>")
    .replace(/\s+/g, " ")
    .trim();
}

async function analyzeFile({
  filePath = "",
  topN = 20,
  useNormalize = true,
} = {}) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const counts = new Map();
  let totalLines = 0;
  let emptyLines = 0;
  let duplicateLines = 0;
  let adjacentDuplicateLines = 0;
  let lastKey = null;

  const stream = fs.createReadStream(absolutePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const rawLine of rl) {
    const trimmed = String(rawLine || "").trim();
    totalLines += 1;
    if (!trimmed) {
      emptyLines += 1;
      continue;
    }
    const key = useNormalize ? normalizeLine(trimmed) : trimmed;
    const prev = counts.get(key) || 0;
    counts.set(key, prev + 1);
    if (prev > 0) duplicateLines += 1;
    if (lastKey !== null && key === lastKey) adjacentDuplicateLines += 1;
    lastKey = key;
  }

  const uniqueLines = counts.size;
  const duplicateRate = totalLines > 0 ? (duplicateLines / totalLines) * 100 : 0;
  const adjacentDuplicateRate = totalLines > 0 ? (adjacentDuplicateLines / totalLines) * 100 : 0;
  const topRepeated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  return {
    absolutePath,
    totalLines,
    emptyLines,
    uniqueLines,
    duplicateLines,
    duplicateRate,
    adjacentDuplicateLines,
    adjacentDuplicateRate,
    topRepeated,
    useNormalize,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(args.length ? 0 : 1);
  }
  const filePath = args[0];
  const topIdx = args.indexOf("--top");
  const topN =
    topIdx >= 0 && Number.isFinite(Number(args[topIdx + 1])) && Number(args[topIdx + 1]) > 0
      ? Math.floor(Number(args[topIdx + 1]))
      : 20;
  const useNormalize = !args.includes("--no-normalize");

  const result = await analyzeFile({ filePath, topN, useNormalize });
  console.log(`File: ${result.absolutePath}`);
  console.log(`Normalize: ${result.useNormalize ? "on" : "off"}`);
  console.log(`Total lines: ${result.totalLines}`);
  console.log(`Empty lines: ${result.emptyLines}`);
  console.log(`Unique lines: ${result.uniqueLines}`);
  console.log(
    `Duplicate lines: ${result.duplicateLines} (${result.duplicateRate.toFixed(2)}%)`,
  );
  console.log(
    `Adjacent duplicates: ${result.adjacentDuplicateLines} (${result.adjacentDuplicateRate.toFixed(2)}%)`,
  );
  console.log(`Top repeated patterns (count > 1, top ${topN}):`);
  if (!result.topRepeated.length) {
    console.log("  (none)");
    return;
  }
  result.topRepeated.forEach(([line, count], index) => {
    console.log(`${String(index + 1).padStart(2, "0")}. [${count}] ${line}`);
  });
}

main().catch((error) => {
  console.error(`[analyze-log-duplicates] ${error?.message || String(error)}`);
  process.exit(1);
});

