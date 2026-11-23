/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPluginArtifactEnvelope,
  reducePluginArtifact,
  requirePluginArtifactAuthority,
} from "../src/plugin-artifact-event.js";

const envelope = createPluginArtifactEnvelope({
  pluginId: "workflow",
  artifactType: "result",
  artifactId: "result-1",
  sessionId: "session-1",
  turnScopeId: "turn-1",
  sequence: 1,
  revision: 1,
  operation: "created",
  baseRevision: null,
  occurredAt: "2026-11-20T00:00:00.000Z",
  data: { text: "结果", nested: { a: false, b: [null, 1] } },
});
const projection = reducePluginArtifact(null, envelope).artifact;

test("artifact authority compares JSON values independently of object property order", () => {
  const value = { ...projection, data: { nested: { b: [null, 1], a: false }, text: "结果" } };
  assert.equal(requirePluginArtifactAuthority(value, envelope), value);
});

for (const [label, alter] of [
  [
    "data",
    (value) => {
      value.data.nested.b[1] = 2;
    },
  ],
  [
    "revision",
    (value) => {
      value.revision = 2;
      value.operation = "replaced";
    },
  ],
  [
    "event identity",
    (value) => {
      value.eventId = "evt_other";
    },
  ],
  [
    "plugin",
    (value) => {
      value.pluginId = "other";
    },
  ],
  [
    "artifact type",
    (value) => {
      value.artifactType = "other";
    },
  ],
  [
    "artifact identity",
    (value) => {
      value.artifactId = "other";
    },
  ],
]) {
  test(`artifact authority rejects a structurally valid forged ${label}`, () => {
    const value = structuredClone(projection);
    alter(value);
    assert.throws(() => requirePluginArtifactAuthority(value, envelope), TypeError);
  });
}

test("artifact authority requires a projection and a valid authoritative envelope", () => {
  assert.throws(() => requirePluginArtifactAuthority(null, envelope), TypeError);
  assert.throws(() => requirePluginArtifactAuthority(projection, null), TypeError);
  assert.throws(
    () =>
      requirePluginArtifactAuthority(projection, {
        ...envelope,
        payload: { ...envelope.payload, baseRevision: 5 },
      }),
    TypeError,
  );
});
