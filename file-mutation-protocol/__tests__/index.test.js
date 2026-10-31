/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FILE_MUTATION_ERROR_CODE,
  FILE_MUTATION_ERROR_STATUS,
  FILE_MUTATION_PROTOCOL,
  FILE_MUTATION_VERSION,
  MUTATION_SNAPSHOT_STATE,
  assertFileMutationResult,
  assertMutationRef,
  createFileDiff,
  createFileMutationDownload,
  createFileMutationDiffPreview,
  createFileMutationError,
  createFileMutationFilePreview,
  createFileMutationLocator,
  createFileMutationResult,
  decodeFileMutationDownloadRequest,
  projectMutationRefs,
} from "../src/index.js";

const ID = "11111111-1111-4111-8111-111111111111";

function textBefore() {
  return {
    exists: true,
    isText: true,
    size: 4,
    sha256: "before",
    snapshotRef: { mutationId: ID, section: "before" },
  };
}

function textAfter() {
  return {
    exists: true,
    isText: true,
    size: 4,
    sha256: "after",
    snapshotRef: { mutationId: ID, section: "after" },
  };
}

function baseInput(overrides = {}) {
  return {
    id: ID,
    operation: "update",
    locator: { view: "workspace", path: "src/example.js" },
    fileName: "example.js",
    before: textBefore(),
    after: textAfter(),
    diff: createFileDiff("old\n", "new\n"),
    sessionScope: null,
    ...overrides,
  };
}

test("file diff preserves Git line semantics and mutation result omits full lines", () => {
  const diff = createFileDiff("same\nold\n", "same\nnew\nextra\n");
  assert.deepEqual(diff.lines, [
    { type: "context", oldLine: 1, newLine: 1, text: "same" },
    { type: "removed", oldLine: 2, newLine: null, text: "old" },
    { type: "added", oldLine: null, newLine: 2, text: "new" },
    { type: "added", oldLine: null, newLine: 3, text: "extra" },
  ]);
  const result = createFileMutationResult(baseInput({ diff }));
  assert.equal(result.version, FILE_MUTATION_VERSION);
  assert.equal(result.mutations[0].diff.lines, undefined);
  assert.equal(Object.hasOwn(result.mutations[0], "sessionScope"), false);
  assert.equal(Object.hasOwn(result.mutations[0], "path"), false);
  assert.deepEqual(result.mutations[0].locator, { view: "workspace", path: "src/example.js" });
  assert.equal(assertFileMutationResult(result), result);
});

test("file mutation locator requires a known view and a canonical path", () => {
  assert.deepEqual(createFileMutationLocator({ view: "host", path: "D:/a.txt" }), {
    view: "host",
    path: "D:/a.txt",
  });
  assert.deepEqual(createFileMutationLocator({ view: "host", path: "d:\\work\\.\\a.txt" }), {
    view: "host",
    path: "D:/work/a.txt",
  });
  assert.deepEqual(createFileMutationLocator({ view: "workspace", path: "./docs\\a.md" }), {
    view: "workspace",
    path: "docs/a.md",
  });
  for (const locator of [
    undefined,
    { view: "workspace", path: "" },
    { view: "workspace", path: "." },
    { view: "workspace", path: "../a.txt" },
    { view: "workspace", path: "/a.txt" },
    { view: "host", path: "a.txt" },
    { view: "host", path: "/home/../a.txt" },
    { view: "disk", path: "a.txt" },
    { path: "a.txt" },
  ]) {
    assert.throws(() => createFileMutationLocator(locator), TypeError);
    assert.throws(() => createFileMutationResult(baseInput({ locator })), TypeError);
  }
});

test("file mutation preview responses are projected from the canonical result", () => {
  const result = createFileMutationResult(baseInput());
  const stored = {
    ...result,
    snapshots: { before: "old\n", after: "new\n", diff: createFileDiff("old\n", "new\n") },
  };
  const locator = { view: "workspace", path: "src/example.js" };
  assert.deepEqual(createFileMutationDiffPreview(stored), {
    ok: true,
    protocol: result.protocol,
    version: result.version,
    mutationId: ID,
    locator,
    diff: stored.snapshots.diff,
  });
  assert.deepEqual(createFileMutationFilePreview(stored), {
    ok: true,
    protocol: result.protocol,
    version: result.version,
    mutationId: ID,
    locator,
    snapshot: MUTATION_SNAPSHOT_STATE.AVAILABLE,
    isText: true,
    size: 4,
    content: "new\n",
  });
});

test("file preview returns null content for binary and deleted mutations", () => {
  const binary = createFileMutationResult(
    baseInput({
      operation: "replace",
      after: { exists: true, isText: false, size: 3, sha256: "bin", snapshotRef: null },
      diff: null,
    }),
  );
  const binaryPreview = createFileMutationFilePreview({
    ...binary,
    snapshots: { before: "old\n", after: null, diff: null },
  });
  assert.equal(binaryPreview.snapshot, MUTATION_SNAPSHOT_STATE.UNAVAILABLE);
  assert.equal(binaryPreview.content, null);

  const deleted = createFileMutationResult(
    baseInput({
      operation: "delete",
      after: { exists: false, isText: false, size: 0, sha256: null, snapshotRef: null },
      diff: createFileDiff("old\n", ""),
    }),
  );
  const deletedPreview = createFileMutationFilePreview({
    ...deleted,
    snapshots: { before: "old\n", after: null, diff: createFileDiff("old\n", "") },
  });
  assert.equal(deletedPreview.snapshot, MUTATION_SNAPSHOT_STATE.DELETED);
  assert.equal(deletedPreview.content, null);
});

test("previews reject records whose snapshots contradict the metadata", () => {
  const result = createFileMutationResult(baseInput());
  assert.throws(() => createFileMutationFilePreview(result), TypeError);
  assert.throws(
    () =>
      createFileMutationFilePreview({
        ...result,
        snapshots: { before: "old\n", after: null, diff: createFileDiff("old\n", "new\n") },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      createFileMutationDiffPreview({
        ...result,
        snapshots: { before: "old\n", after: "new\n", diff: null },
      }),
    TypeError,
  );
});

test("file mutation result requires an explicit sessionScope", () => {
  for (const sessionScope of [undefined, "", "scope", 0]) {
    assert.throws(() => createFileMutationResult(baseInput({ sessionScope })), TypeError);
  }
  const scope = { scopeId: "agent:x", parentSessionId: "p", relativeDir: "d", allowedRoot: "r" };
  assert.deepEqual(
    createFileMutationResult(baseInput({ sessionScope: scope })).mutations[0].sessionScope,
    scope,
  );
});

test("assertFileMutationResult rejects incomplete before/after/diff metadata", () => {
  const cases = [
    { before: { exists: true } },
    { before: { exists: true, sha256: null } },
    { after: { exists: true, isText: true, size: 1 } },
    { after: { exists: false, isText: false, size: 0, sha256: "x" } },
    { after: { exists: true, isText: true, size: -1, sha256: "x" } },
    { diff: { additions: 1 } },
  ];
  for (const overrides of cases) {
    const result = createFileMutationResult(baseInput(overrides));
    assert.throws(() => assertFileMutationResult(result), TypeError, JSON.stringify(overrides));
  }
});

test("projectMutationRefs projects available, unavailable and deleted states", () => {
  const available = projectMutationRefs(
    createFileMutationResult(
      baseInput({
        aggregate: { scopeId: "turn-1", revision: 3, diffCount: 3 },
        sessionScope: { scopeId: "s" },
      }),
    ),
  );
  assert.deepEqual(available, [
    {
      mutationId: ID,
      revision: 3,
      operation: "update",
      locator: { view: "workspace", path: "src/example.js" },
      fileName: "example.js",
      beforeSha256: "before",
      afterSha256: "after",
      size: 4,
      additions: 1,
      deletions: 1,
      snapshot: MUTATION_SNAPSHOT_STATE.AVAILABLE,
      sessionScope: { scopeId: "s" },
    },
  ]);
  assert.equal(assertMutationRef(available[0]), available[0]);

  const [unavailable] = projectMutationRefs(
    createFileMutationResult(
      baseInput({
        operation: "create",
        locator: { view: "host", path: "D:/work/a.xlsx" },
        fileName: "a.xlsx",
        before: { exists: false, isText: true, size: 0, sha256: null, snapshotRef: null },
        after: { exists: true, isText: false, size: 9, sha256: "bin", snapshotRef: null },
        diff: null,
      }),
    ),
  );
  assert.equal(unavailable.revision, 1);
  assert.equal(unavailable.snapshot, MUTATION_SNAPSHOT_STATE.UNAVAILABLE);
  assert.equal(unavailable.beforeSha256, null);
  assert.equal(unavailable.additions, null);
  assert.equal(unavailable.deletions, null);
  assert.equal(assertMutationRef(unavailable), unavailable);

  const [deleted] = projectMutationRefs(
    createFileMutationResult(
      baseInput({
        operation: "delete",
        after: { exists: false, isText: false, size: 0, sha256: null, snapshotRef: null },
        diff: createFileDiff("old\n", ""),
      }),
    ),
  );
  assert.equal(deleted.snapshot, MUTATION_SNAPSHOT_STATE.DELETED);
  assert.equal(deleted.afterSha256, null);
  assert.equal(assertMutationRef(deleted), deleted);
});

test("projectMutationRefs yields [] for non-envelopes and throws on protocol violations", () => {
  for (const value of [null, "text", 1, [], {}, { ok: true, mutations: [] }]) {
    assert.deepEqual(projectMutationRefs(value), []);
  }
  assert.deepEqual(
    projectMutationRefs({
      protocol: FILE_MUTATION_PROTOCOL,
      version: FILE_MUTATION_VERSION,
      ok: true,
      mutations: [],
    }),
    [],
  );
  const valid = createFileMutationResult(baseInput());
  assert.throws(() => projectMutationRefs({ ...valid, version: 2 }), TypeError);
  assert.throws(
    () =>
      projectMutationRefs({
        ...valid,
        mutations: [{ ...valid.mutations[0], locator: undefined, path: "src/example.js" }],
      }),
    TypeError,
  );
});

test("assertMutationRef rejects refs that break field semantics", () => {
  const [ref] = projectMutationRefs(createFileMutationResult(baseInput()));
  const cases = [
    { mutationId: "" },
    { revision: 0 },
    { operation: "move" },
    { locator: { view: "workspace", path: "" } },
    { fileName: "" },
    { size: -1 },
    { additions: null },
    { additions: -1 },
    { snapshot: "gone" },
    { snapshot: MUTATION_SNAPSHOT_STATE.DELETED },
    { afterSha256: null },
    { sessionScope: "scope" },
  ];
  for (const overrides of cases) {
    assert.throws(
      () => assertMutationRef({ ...ref, ...overrides }),
      TypeError,
      JSON.stringify(overrides),
    );
  }
});

const AFTER_SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);

function downloadRecord(overrides = {}, snapshots = {}) {
  const result = createFileMutationResult(
    baseInput({
      after: { ...textAfter(), sha256: AFTER_SHA },
      ...overrides,
    }),
  );
  return {
    ...result,
    snapshots: {
      before: "old\n",
      after: "new\n",
      diff: createFileDiff("old\n", "new\n"),
      ...snapshots,
    },
  };
}

test("every file mutation error code carries exactly one protocol status", () => {
  assert.deepEqual(
    Object.keys(FILE_MUTATION_ERROR_STATUS).sort(),
    Object.values(FILE_MUTATION_ERROR_CODE).sort(),
  );
  const cause = new Error("io");
  const error = createFileMutationError(FILE_MUTATION_ERROR_CODE.COMMIT_FAILED, "failed", {
    cause,
    details: { path: "a" },
  });
  assert.equal(error.code, FILE_MUTATION_ERROR_CODE.COMMIT_FAILED);
  assert.equal(error.statusCode, 500);
  assert.equal(error.cause, cause);
  assert.deepEqual(error.details, { path: "a" });
  assert.throws(() => createFileMutationError("unknown_code", "x"), TypeError);
});

test("decodeFileMutationDownloadRequest accepts only canonical revision and sha256", () => {
  assert.deepEqual(decodeFileMutationDownloadRequest({ revision: "12", afterSha256: AFTER_SHA }), {
    revision: 12,
    afterSha256: AFTER_SHA,
  });
  const invalid = [
    {},
    { revision: "0", afterSha256: AFTER_SHA },
    { revision: "1.0", afterSha256: AFTER_SHA },
    { revision: "01", afterSha256: AFTER_SHA },
    { revision: 1, afterSha256: AFTER_SHA },
    { revision: "1" },
    { revision: "1", afterSha256: "A".repeat(64) },
    { revision: "1", afterSha256: ["a".repeat(64)] },
  ];
  for (const query of invalid) {
    assert.throws(
      () => decodeFileMutationDownloadRequest(query),
      { code: FILE_MUTATION_ERROR_CODE.INVALID_DOWNLOAD_REQUEST, statusCode: 400 },
      JSON.stringify(query),
    );
  }
});

test("createFileMutationDownload serves only the exact stored version", () => {
  const record = downloadRecord();
  assert.deepEqual(createFileMutationDownload(record, { revision: 1, afterSha256: AFTER_SHA }), {
    mutationId: ID,
    fileName: "example.js",
    sha256: AFTER_SHA,
    content: "new\n",
  });
  assert.throws(() => createFileMutationDownload(record, { revision: 2, afterSha256: AFTER_SHA }), {
    code: FILE_MUTATION_ERROR_CODE.SNAPSHOT_OVERWRITTEN,
    statusCode: 409,
  });
  assert.throws(() => createFileMutationDownload(record, { revision: 1, afterSha256: OTHER_SHA }), {
    code: FILE_MUTATION_ERROR_CODE.SNAPSHOT_OVERWRITTEN,
  });
  assert.throws(
    () => createFileMutationDownload(record, { revision: "1", afterSha256: AFTER_SHA }),
    {
      code: FILE_MUTATION_ERROR_CODE.INVALID_DOWNLOAD_REQUEST,
    },
  );
});

test("createFileMutationDownload binds aggregate revisions", () => {
  const record = downloadRecord({
    aggregate: { scopeId: "turn-1", revision: 3, diffCount: 3 },
  });
  assert.equal(
    createFileMutationDownload(record, { revision: 3, afterSha256: AFTER_SHA }).content,
    "new\n",
  );
  assert.throws(() => createFileMutationDownload(record, { revision: 2, afterSha256: AFTER_SHA }), {
    code: FILE_MUTATION_ERROR_CODE.SNAPSHOT_OVERWRITTEN,
  });
});

test("createFileMutationDownload reports deleted and unavailable snapshots", () => {
  const deleted = downloadRecord(
    {
      operation: "delete",
      after: { exists: false, isText: false, size: 0, sha256: null, snapshotRef: null },
      diff: createFileDiff("old\n", ""),
    },
    { after: null, diff: createFileDiff("old\n", "") },
  );
  assert.throws(
    () => createFileMutationDownload(deleted, { revision: 1, afterSha256: AFTER_SHA }),
    {
      code: FILE_MUTATION_ERROR_CODE.RESOURCE_DELETED,
      statusCode: 410,
    },
  );
  const binary = downloadRecord(
    {
      operation: "replace",
      after: { exists: true, isText: false, size: 3, sha256: AFTER_SHA, snapshotRef: null },
      diff: null,
    },
    { after: null, diff: null },
  );
  assert.throws(() => createFileMutationDownload(binary, { revision: 1, afterSha256: AFTER_SHA }), {
    code: FILE_MUTATION_ERROR_CODE.SNAPSHOT_UNAVAILABLE,
    statusCode: 409,
  });
});
