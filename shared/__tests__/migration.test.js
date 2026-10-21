/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MIGRATION_UNMAPPABLE_CODE, defineVersionChain, runVersionChain } from "../migration.js";

const readVersion = (document) => document.version;
const chain = defineVersionChain({
  kind: "sample",
  currentVersion: 3,
  readVersion,
  steps: [
    { from: 1, to: 2, migrate: (document) => ({ ...document, version: 2, b: document.a }) },
    { from: 2, to: 3, migrate: (document) => ({ version: 3, c: document.b }) },
  ],
});

test("version chain applies every step from the stored version", () => {
  assert.deepEqual(runVersionChain(chain, { version: 1, a: "x" }), {
    document: { version: 3, c: "x" },
    fromVersion: 1,
    toVersion: 3,
    migrated: true,
  });
  assert.equal(runVersionChain(chain, { version: 2, b: "y" }).document.c, "y");
});

test("version chain returns current documents unchanged", () => {
  const document = { version: 3, c: "z" };
  assert.equal(runVersionChain(chain, document).document, document);
  assert.equal(runVersionChain(chain, document).migrated, false);
});

test("version chain rejects versions outside the chain as unmappable", () => {
  for (const version of [0, 4, undefined]) {
    assert.throws(
      () => runVersionChain(chain, { version }),
      (error) => error.code === MIGRATION_UNMAPPABLE_CODE && error.details.kind === "sample",
    );
  }
});

test("version chain rejects steps that do not advance the version", () => {
  const broken = defineVersionChain({
    kind: "broken",
    currentVersion: 2,
    readVersion,
    steps: [{ from: 1, to: 2, migrate: (document) => document }],
  });
  assert.throws(
    () => runVersionChain(broken, { version: 1 }),
    (error) => error.details.reason === "step_did_not_advance_version",
  );
});

test("version chain definitions must be contiguous single steps", () => {
  const migrate = (document) => document;
  assert.throws(() =>
    defineVersionChain({
      kind: "gap",
      currentVersion: 3,
      readVersion,
      steps: [{ from: 1, to: 2, migrate }],
    }),
  );
  assert.throws(() =>
    defineVersionChain({
      kind: "skip",
      currentVersion: 3,
      readVersion,
      steps: [{ from: 1, to: 3, migrate }],
    }),
  );
  assert.throws(() =>
    defineVersionChain({
      kind: "dup",
      currentVersion: 2,
      readVersion,
      steps: [
        { from: 1, to: 2, migrate },
        { from: 1, to: 2, migrate },
      ],
    }),
  );
});
