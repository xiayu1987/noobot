/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { UNSUPPORTED_SESSION_STORAGE } from "@noobot/session-protocol/session-storage-format";
import { requirePartitionSessionAuthority } from "@noobot/session-protocol/session-reader";
import { SESSION_ARTIFACT_FILE_NAMES } from "../../src/session/session-artifact-files.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionJournalOwner } from "../../src/session/partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import { partitionReaderAccess } from "../helpers/partition-reader-fixture.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";

const oldAuthorityFiles = [
  UNSUPPORTED_SESSION_STORAGE.head,
  UNSUPPORTED_SESSION_STORAGE.format,
  SESSION_ARTIFACT_FILE_NAMES.session,
];

async function fixture(context) {
  const workspace = await mkdtemp(join(tmpdir(), "partition-authority-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const root = join(workspace, "session");
  await mkdir(root);
  const scope = { sessionDir: root, sessionId: "session", parentSessionId: "" };
  const options = {
    root,
    sessionId: scope.sessionId,
    durableAncestor: workspace,
    limits: journalTestLimits(),
    publication: "collections",
  };
  const owner = new PartitionJournalOwner({ ...options, maxJournals: 1 });
  context.after(() => owner.close());
  const access = createPartitionSessionReaderAccess({
    acquireJournal: owner.acquire.bind(owner),
    withJournalRemoval: owner.withRemoval.bind(owner),
  });
  return { root, scope, options, owner, access };
}

test("partition authority protocol requires explicit facts and rejects competing authorities", () => {
  assert.equal(
    requirePartitionSessionAuthority({ partition: false, immutable: false, document: false }),
    false,
  );
  assert.equal(
    requirePartitionSessionAuthority({ partition: true, immutable: false, document: false }),
    true,
  );
  assert.throws(() => requirePartitionSessionAuthority({ partition: false }), TypeError);
  for (const partition of [false, true]) {
    for (const [immutable, document] of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      assert.throws(() => requirePartitionSessionAuthority({ partition, immutable, document }), {
        code: partition ? "SESSION_STORAGE_CORRUPT" : "SESSION_STORAGE_FORMAT_UNSUPPORTED",
      });
    }
  }
});

for (const file of oldAuthorityFiles) {
  test(`partition access rejects ${file} before opening a journal or changing files`, async (context) => {
    const { root, scope, options, access } = await fixture(context);
    const evidence = Buffer.from("old authority evidence");
    await writeFile(join(root, file), evidence);
    const before = await readdir(root);
    for (const operation of [
      () => access.readPlacement(scope),
      () => access.recover(scope),
      () => access.open(scope),
      () => access.withMutation(scope, () => assert.fail("Must not run mutation")),
      () => access.create(scope, { session: { sessionId: "session", parentSessionId: "" } }),
      () => PartitionJournal.create(options),
      () => PartitionJournal.open(options),
    ]) {
      await assert.rejects(operation(), { code: "SESSION_STORAGE_FORMAT_UNSUPPORTED" });
      assert.deepEqual(await readdir(root), before);
      assert.deepEqual(await readFile(join(root, file)), evidence);
    }
  });

  test(`mixed partition and ${file} authorities cannot be recovered or mutated`, async (context) => {
    const { root, scope, options, owner, access } = await fixture(context);
    const lease = await owner.acquire(scope, { create: true });
    await lease.release();
    const current = await readFile(join(root, "CURRENT"));
    await writeFile(join(root, file), "competing authority");
    const before = await readdir(root);
    for (const operation of [
      () => access.readPlacement(scope),
      () => access.recover(scope),
      () => access.open(scope),
      () => access.withMutation(scope, () => assert.fail("Must not run mutation")),
      () => access.create(scope, { session: { sessionId: "session", parentSessionId: "" } }),
      () => PartitionJournal.create(options),
      () => PartitionJournal.open(options),
      () => partitionReaderAccess.readPlacement(scope),
      () => partitionReaderAccess.recover(scope),
      () => partitionReaderAccess.open(scope),
      () => partitionReaderAccess.withMutation(scope, () => assert.fail("Must not mutate")),
      () =>
        partitionReaderAccess.create(scope, {
          session: { sessionId: "session", parentSessionId: "" },
        }),
      () => partitionReaderAccess.openArtifact(scope),
    ]) {
      await assert.rejects(operation(), { code: "SESSION_STORAGE_CORRUPT" });
      assert.deepEqual(await readdir(root), before);
      assert.deepEqual(await readFile(join(root, "CURRENT")), current);
      assert.equal(await readFile(join(root, file), "utf8"), "competing authority");
    }
  });
}

test("missing directories remain absent during placement discovery", async (context) => {
  const { root, scope } = await fixture(context);
  await rm(root, { recursive: true });
  const access = createPartitionSessionReaderAccess({
    acquireJournal: () => assert.fail("Missing sessions must not acquire an owner"),
    withJournalRemoval: () => assert.fail("Unexpected journal removal"),
  });
  assert.equal(await access.readPlacement(scope), null);
  assert.equal(await access.recover(scope), null);
  await assert.rejects(readdir(root), { code: "ENOENT" });
});
