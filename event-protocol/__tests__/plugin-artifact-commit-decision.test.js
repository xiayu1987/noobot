/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PLUGIN_ARTIFACT_ERROR_CODE,
  createPluginArtifactCommitReceipt,
  createPluginArtifactCommitRejection,
  createPluginArtifactEnvelope,
  createPluginArtifactQueryResult,
  decidePluginArtifactCommit,
  reducePluginArtifact,
} from "../src/index.js";

const current = Object.freeze({ revision: 2, eventId: "evt_current", operation: "replaced" });

function envelopeFor(overrides = {}) {
  return createPluginArtifactEnvelope({
    sequence: 1,
    revision: 1,
    occurredAt: "2026-10-22T00:00:00.000Z",
    operation: "created",
    baseRevision: null,
    pluginId: "example",
    artifactType: "example.document",
    artifactId: "document-1",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    data: { title: "document" },
    ...overrides,
  });
}

test("plugin artifact commit decision assigns the next revision for allowed commits", () => {
  assert.deepEqual(decidePluginArtifactCommit(null, { operation: "created", baseRevision: null }), {
    allowed: true,
    revision: 1,
  });
  assert.deepEqual(
    decidePluginArtifactCommit(current, { operation: "replaced", baseRevision: 2 }),
    {
      allowed: true,
      revision: 3,
    },
  );
});

test("plugin artifact commit decision rejects with one code, reason and current revision", () => {
  assert.deepEqual(
    decidePluginArtifactCommit(current, { operation: "created", baseRevision: null }),
    {
      allowed: false,
      code: PLUGIN_ARTIFACT_ERROR_CODE.ALREADY_EXISTS,
      reason: "artifact_exists",
      currentRevision: 2,
    },
  );
  assert.equal(
    decidePluginArtifactCommit(null, { operation: "replaced", baseRevision: 1 }).code,
    PLUGIN_ARTIFACT_ERROR_CODE.NOT_FOUND,
  );
  assert.deepEqual(
    decidePluginArtifactCommit(current, { operation: "replaced", baseRevision: 1 }),
    {
      allowed: false,
      code: PLUGIN_ARTIFACT_ERROR_CODE.REVISION_CONFLICT,
      reason: "revision_conflict",
      currentRevision: 2,
    },
  );
});

test("plugin artifact commit decision rejects malformed current artifacts and operations", () => {
  assert.throws(
    () =>
      decidePluginArtifactCommit({ revision: "2" }, { operation: "created", baseRevision: null }),
    /current artifact or null/,
  );
  assert.throws(
    () => decidePluginArtifactCommit(undefined, { operation: "created", baseRevision: null }),
    /current artifact or null/,
  );
  assert.throws(
    () => decidePluginArtifactCommit(null, { operation: "appended", baseRevision: null }),
    /invalid plugin artifact operation/,
  );
});

test("plugin artifact commit rejection only wraps rejected decisions", () => {
  const decision = decidePluginArtifactCommit(current, { operation: "replaced", baseRevision: 1 });
  assert.deepEqual(createPluginArtifactCommitRejection(decision), {
    committed: false,
    code: PLUGIN_ARTIFACT_ERROR_CODE.REVISION_CONFLICT,
    reason: "revision_conflict",
    currentRevision: 2,
  });
  assert.throws(
    () => createPluginArtifactCommitRejection({ allowed: true, revision: 1 }),
    /rejected commit decision/,
  );
  assert.throws(
    () =>
      createPluginArtifactCommitRejection({ allowed: false, code: "UNKNOWN", currentRevision: 0 }),
    /rejected commit decision/,
  );
  assert.throws(
    () =>
      createPluginArtifactCommitRejection({
        allowed: false,
        code: PLUGIN_ARTIFACT_ERROR_CODE.NOT_FOUND,
        currentRevision: -1,
      }),
    /integer currentRevision/,
  );
});

test("plugin artifact commit receipt is projected from a valid committed envelope only", () => {
  const envelope = envelopeFor();
  assert.deepEqual(createPluginArtifactCommitReceipt(envelope), {
    committed: true,
    eventId: envelope.identity.eventId,
    operation: "created",
    revision: 1,
  });
  assert.throws(
    () =>
      createPluginArtifactCommitReceipt({
        ...envelope,
        payload: { ...envelope.payload, revision: 0 },
      }),
    /invalid committed plugin artifact/,
  );
});

test("plugin artifact query result has one found and one missing shape", () => {
  assert.deepEqual(createPluginArtifactQueryResult(null), {
    found: false,
    artifact: null,
    revision: 0,
  });
  assert.deepEqual(createPluginArtifactQueryResult({ ...current, data: { title: "document" } }), {
    found: true,
    revision: 2,
    operation: "replaced",
    artifact: { title: "document" },
    eventId: "evt_current",
  });
  assert.throws(() => createPluginArtifactQueryResult(undefined), /projected artifact or null/);
  assert.throws(
    () => createPluginArtifactQueryResult({ revision: 1, eventId: "" }),
    /projected artifact or null/,
  );
});

test("plugin artifact reducer shares the commit decision with the authority", () => {
  const created = reducePluginArtifact(null, envelopeFor());
  assert.equal(created.applied, true);
  assert.equal(reducePluginArtifact(created.artifact, envelopeFor()).reason, "artifact_exists");
  const stale = envelopeFor({ operation: "replaced", baseRevision: 2, revision: 3 });
  assert.equal(reducePluginArtifact(created.artifact, stale).reason, "revision_conflict");
  assert.equal(reducePluginArtifact(null, stale).reason, "artifact_not_found");
  const replaced = envelopeFor({ operation: "replaced", baseRevision: 1, revision: 2 });
  assert.equal(reducePluginArtifact(created.artifact, replaced).artifact.revision, 2);
});
