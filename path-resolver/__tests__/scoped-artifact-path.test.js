/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  SCOPED_ARTIFACT_PATH_ERROR,
  isScopedArtifactReferenceValid,
  normalizeScopedArtifactReference,
  resolveScopedArtifactPath,
} from "../src/scoped-artifact-path.js";

const baseDir = path.resolve("/srv/session");
const scope = { baseDir, scopeDir: "turns", extensions: [".json", ".jsonl"] };

test("resolves a reference inside the scope directory", () => {
  assert.equal(
    resolveScopedArtifactPath({ ...scope, reference: "turns/turn-1.jsonl" }),
    path.resolve(baseDir, "turns/turn-1.jsonl"),
  );
});

test("normalizes windows separators before validation", () => {
  assert.equal(normalizeScopedArtifactReference("turns\\turn-1.json"), "turns/turn-1.json");
  assert.equal(
    resolveScopedArtifactPath({ ...scope, reference: "turns\\turn-1.json" }),
    path.resolve(baseDir, "turns/turn-1.json"),
  );
});

test("rejects empty, absolute, nul and dot references", () => {
  for (const reference of ["", path.resolve("/etc/passwd"), "turns/a\0.json", "."]) {
    assert.equal(isScopedArtifactReferenceValid({ ...scope, reference }), false);
  }
});

test("rejects traversal outside the scope directory", () => {
  for (const reference of ["../outside.json", "turns/../../outside.json", "other/turn-1.json"]) {
    assert.equal(isScopedArtifactReferenceValid({ ...scope, reference }), false);
  }
});

test("does not treat a sibling name prefixed with dots as traversal", () => {
  assert.equal(isScopedArtifactReferenceValid({ ...scope, reference: "turns/..keep.json" }), true);
});

test("accepts the scope root itself when the extension matches", () => {
  assert.equal(
    isScopedArtifactReferenceValid({
      baseDir,
      reference: "turns.json",
      scopeDir: "turns.json",
      extensions: [".json"],
    }),
    true,
  );
});

test("enforces the extension allow list", () => {
  assert.equal(isScopedArtifactReferenceValid({ ...scope, reference: "turns/turn-1.txt" }), false);
  assert.equal(
    isScopedArtifactReferenceValid({
      baseDir,
      reference: "turns/turn-1.txt",
      scopeDir: "turns",
    }),
    true,
  );
});

test("throws with the caller error code and label", () => {
  assert.throws(
    () =>
      resolveScopedArtifactPath({
        ...scope,
        reference: "../outside.json",
        errorCode: "SESSION_TURN_ARTIFACT_PATH_INVALID",
        errorLabel: "session turn artifact reference",
      }),
    (error) =>
      error.code === "SESSION_TURN_ARTIFACT_PATH_INVALID" &&
      error.message === "invalid session turn artifact reference: ../outside.json",
  );
  assert.throws(() => resolveScopedArtifactPath({ ...scope, reference: "" }), {
    code: SCOPED_ARTIFACT_PATH_ERROR,
  });
});
