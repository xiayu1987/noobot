/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createDefaultRuntimeParamsDocument } from "@noobot/shared/runtime-params";
import { WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_VERSION } from "@noobot/workspace-protocol";
import {
  partitionMigrationAuthorityPath,
  partitionMigrationRoot,
  readImmutableAuthority,
  readPartitionStorageRoot,
} from "../src/session/session-storage-authority.js";
import { migrateImmutableSessionToPartition } from "../src/workspace-lifecycle/migrate-immutable-session-to-partition.js";
import { journalTestLimits } from "./helpers/partition-journal-cases.js";
import {
  createIsolatedMigrationFixture,
  execFileAsync,
} from "./workspace-isolated-immutable-migration.test-helpers.js";
import { fixture } from "./workspace-session-immutable-storage-upgrade.test-helpers.js";

test("offline workspace CLI commits partition publication through the layout upgrade chain", async (t) => {
  const workspaceDir = await mkdtemp(join(tmpdir(), "workspace-cutover-cli-"));
  t.after(() => rm(workspaceDir, { recursive: true, force: true }));
  const sessionDir = join(workspaceDir, WORKSPACE_LAYOUT.SESSION_DIR, "s1");
  await mkdir(dirname(sessionDir), { recursive: true });
  await rename(await fixture(t), sessionDir);
  const pluginRootDir = fileURLToPath(new URL("../../plugin/", import.meta.url));
  const script = fileURLToPath(new URL("../scripts/migrate-session-storage.js", import.meta.url));
  const runtimeFile = join(workspaceDir, "runtime-params.json");
  const planFile = join(workspaceDir, "migration-plan.json");
  const layoutFile = join(workspaceDir, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  const marker = partitionMigrationAuthorityPath(sessionDir);
  await writeFile(layoutFile, JSON.stringify({ version: 34 }));
  await writeFile(runtimeFile, JSON.stringify(createDefaultRuntimeParamsDocument()));
  await writeFile(
    planFile,
    JSON.stringify({
      workspaceDir,
      pluginRootDir,
      targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
    }),
  );
  const run = (mode) => execFileAsync(process.execPath, [script, mode, runtimeFile, planFile]);

  await writeFile(layoutFile, JSON.stringify({ version: WORKSPACE_LAYOUT_VERSION + 1 }));
  await assert.rejects(run("--upgrade-workspace"));
  await assert.rejects(stat(marker), { code: "ENOENT" });
  await writeFile(layoutFile, JSON.stringify({ version: 34 }));
  const result = JSON.parse((await run("--upgrade-workspace")).stdout);
  assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
  const { result: migration } = result.layoutUpgrades.find(
    ({ id }) => id === "session-partition-storage-v46",
  );
  assert.equal(migration.receipts.length, 1);
  assert.equal(migration.receipts[0].source.sessionId, "s1");
  assert.equal(await readPartitionStorageRoot(sessionDir), partitionMigrationRoot(sessionDir));
  assert.deepEqual(JSON.parse((await run("--upgrade-workspace")).stdout).layoutUpgrades, []);
});

test("offline CLI rejects single-session cutover and retries interrupted workspace upgrades", async (t) => {
  const { options: source } = await createIsolatedMigrationFixture(t);
  const { sessionDir, scratchRoot, expectedSource } = source;
  const workspaceDir = dirname(scratchRoot);
  const layoutFile = join(workspaceDir, WORKSPACE_LAYOUT.LAYOUT_STATE_FILE);
  const pluginRootDir = fileURLToPath(new URL("../../plugin/", import.meta.url));
  const targetStorageBudget = { journalLimits: journalTestLimits(), maxJournals: 1 };
  const singleSessionPlan = {
    sessionDir,
    expectedSource,
    targetStorageBudget,
    limit: 2,
    maxBytes: 4096,
  };
  const plan = { workspaceDir, pluginRootDir, targetStorageBudget };
  const runtimeFile = join(scratchRoot, "runtime-params.json");
  const planFile = join(scratchRoot, "migration-plan.json");
  const script = fileURLToPath(new URL("../scripts/migrate-session-storage.js", import.meta.url));
  const args = [script, "--upgrade-workspace", runtimeFile, planFile];
  const run = () => execFileAsync(process.execPath, args);
  const marker = partitionMigrationAuthorityPath(sessionDir);
  const target = partitionMigrationRoot(sessionDir);
  await writeFile(layoutFile, JSON.stringify({ version: 45 }));
  await writeFile(planFile, JSON.stringify(singleSessionPlan));
  await assert.rejects(run(), { stderr: /ENOENT.*runtime-params\.json/ });
  await writeFile(runtimeFile, JSON.stringify(createDefaultRuntimeParamsDocument()));
  await assert.rejects(execFileAsync(process.execPath, [script, runtimeFile, planFile]), {
    stderr: /Usage \(offline\).*--upgrade-workspace/,
  });
  await assert.rejects(run(), {
    stderr: /Invalid offline workspace partition migration plan fields/,
  });
  const overLimit = {
    ...singleSessionPlan,
    limit: targetStorageBudget.journalLimits.pageRecords + 1,
  };
  await assert.rejects(migrateImmutableSessionToPartition(overLimit), {
    message: "Migration page limit exceeds target journal pageRecords",
  });
  await assert.rejects(stat(marker), { code: "ENOENT" });
  await assert.rejects(stat(target), { code: "ENOENT" });
  await readImmutableAuthority(sessionDir);

  await writeFile(planFile, JSON.stringify(plan));
  const preload = join(scratchRoot, "interrupt-migration.mjs");
  const journalModule = new URL(
    "../src/session/partition-storage/partition-journal.js",
    import.meta.url,
  );
  await writeFile(
    preload,
    `
      import { once } from "node:events";
      import { PartitionJournal } from ${JSON.stringify(journalModule.href)};
      const read = PartitionJournal.prototype.readSequencePage;
      PartitionJournal.prototype.readSequencePage = async function (selection) {
        const page = await read.call(this, selection);
        // Signal listeners do not keep Node alive while waiting for delivery.
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), 5000);
        try {
          const delivered = once(process, "SIGTERM", { signal: deadline.signal });
          process.kill(process.pid, "SIGTERM");
          await delivered;
        } finally {
          clearTimeout(timer);
        }
        return page;
      };
    `,
  );
  await assert.rejects(execFileAsync(process.execPath, ["--import", preload, ...args]), {
    code: 143,
    stdout: "",
    stderr: /Session storage migration interrupted by SIGTERM/,
  });
  assert.equal(JSON.parse(await readFile(layoutFile)).version, 45);
  await assert.rejects(stat(marker), { code: "ENOENT" });
  await readImmutableAuthority(sessionDir);
  const { stdout } = await run();
  const [{ result: migration }] = JSON.parse(stdout).layoutUpgrades;
  assert.equal(JSON.parse(await readFile(layoutFile)).version, WORKSPACE_LAYOUT_VERSION);
  assert.equal(migration.receipts.length, 1);
  const [receipt] = migration.receipts;
  assert.deepEqual(receipt.source, expectedSource);
  assert.equal(await readPartitionStorageRoot(sessionDir), target);
  const selector = await stat(marker);
  assert.deepEqual(JSON.parse((await run()).stdout).layoutUpgrades, []);
  assert.equal((await stat(marker)).ino, selector.ino);
});
