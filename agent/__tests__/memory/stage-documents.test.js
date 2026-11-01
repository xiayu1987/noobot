/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { renderMemoryDocument } from "@noobot/memory-protocol/document";
import {
  EXPERIENCE_PATCH_SCHEMA,
  resolveExperienceDocumentSegments,
} from "@noobot/memory-protocol/experience/schema";
import { StorageManager } from "../../src/memory/storage/index.js";
import { mergeStageDocumentsByDomain } from "../../src/memory/experience/stage-documents.js";
import { saveWeeklyDomainSummary } from "../../src/memory/experience/weekly/saver.js";
import { saveMonthlyDomainSummary } from "../../src/memory/experience/monthly/saver.js";

const storage = new StorageManager({});

async function withRoot(run) {
  const root = await mkdtemp(path.join(tmpdir(), "noobot-stage-documents-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeStageDocument(root, stage, periodKey, values, body) {
  const filePath = path.join(root, periodKey, ...resolveExperienceDocumentSegments(stage, values));
  await storage.ensureDir(path.dirname(filePath));
  await storage.writeText(
    filePath,
    renderMemoryDocument(EXPERIENCE_PATCH_SCHEMA[stage].documentKind, body),
  );
}

test("resolveExperienceDocumentSegments follows the stage path fields", () => {
  const values = { domain: "d", category: "c", subcategory: "s" };
  assert.deepEqual(resolveExperienceDocumentSegments("daily", values), ["d.md"]);
  assert.deepEqual(resolveExperienceDocumentSegments("weekly", values), ["d", "c.md"]);
  assert.deepEqual(resolveExperienceDocumentSegments("monthly", values), ["d", "c", "s.md"]);
  assert.deepEqual(resolveExperienceDocumentSegments("yearly", values), ["d", "c", "s.md"]);
  assert.throws(
    () => resolveExperienceDocumentSegments("weekly", { domain: "d" }),
    /requires category/,
  );
});

for (const stage of ["daily", "weekly", "monthly"]) {
  test(`${stage} documents merge per outermost domain in period order`, () =>
    withRoot(async (root) => {
      const doc = (domain, leaf) => ({ domain, category: leaf, subcategory: leaf });
      await writeStageDocument(root, stage, "p2", doc("alpha", "x"), "second");
      await writeStageDocument(root, stage, "p1", doc("alpha", "x"), "first");
      await writeStageDocument(root, stage, "p1", doc("beta", "y"), "beta");
      const merged = await mergeStageDocumentsByDomain({
        storage,
        stage,
        periodDir: root,
        periodKeys: ["p1", "p2", "missing"],
      });
      assert.deepEqual(Object.fromEntries(merged), {
        alpha: "first\n\nsecond",
        beta: "beta",
      });
    }));
}

test("documents outside the declared depth are ignored", () =>
  withRoot(async (root) => {
    await writeStageDocument(root, "weekly", "p1", { domain: "a", category: "c" }, "ok");
    await storage.writeText(path.join(root, "p1", "stray.md"), "not a weekly doc");
    const merged = await mergeStageDocumentsByDomain({
      storage,
      stage: "weekly",
      periodDir: root,
      periodKeys: ["p1"],
    });
    assert.deepEqual(Object.fromEntries(merged), { a: "ok" });
  }));

test("saved weekly and monthly summaries are read back by the stage merger", () =>
  withRoot(async (basePath) => {
    const categories = [{ category: "c", subcategories: [{ subcategory: "s" }] }];
    await saveWeeklyDomainSummary({
      storage,
      basePath,
      weekLabel: "2026-W01",
      domainName: "dom",
      categories,
      createdAt: "t",
      sourceDates: [],
    });
    await saveMonthlyDomainSummary({
      storage,
      basePath,
      monthKey: "2026-01",
      domainName: "dom",
      categories,
      createdAt: "t",
      sourceWeeks: [],
    });
    const weekly = await mergeStageDocumentsByDomain({
      storage,
      stage: "weekly",
      periodDir: storage.weeklySummaryDir(basePath),
      periodKeys: ["2026-W01"],
    });
    const monthly = await mergeStageDocumentsByDomain({
      storage,
      stage: "monthly",
      periodDir: storage.monthlySummaryDir(basePath),
      periodKeys: ["2026-01"],
    });
    assert.deepEqual([...weekly.keys()], ["dom"]);
    assert.deepEqual([...monthly.keys()], ["dom"]);
  }));
