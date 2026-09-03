/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  extractGeneratedMediaCandidates,
  fetchRemoteMediaArtifact,
} from "../../../src/artifacts/runtime/artifact-service.js";

test("extractGeneratedMediaCandidates extracts inline base64 media without storage metadata", () => {
  const candidates = extractGeneratedMediaCandidates([
    {
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,ZmFrZQ==",
      },
    },
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.mimeType, "image/png");
  assert.equal(candidates[0]?.contentBase64, "ZmFrZQ==");
  assert.equal("path" in candidates[0], false);
  assert.equal("attachmentMeta" in candidates[0], false);
});

test("fetchRemoteMediaArtifact returns null when remote response is not ok", async () => {
  const artifact = await fetchRemoteMediaArtifact(
    "https://example.com/a.png",
    async () => ({
      ok: false,
      status: 404,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
    1,
    {},
  );
  assert.equal(artifact, null);
});

test("fetchRemoteMediaArtifact returns null when fetch throws", async () => {
  const artifact = await fetchRemoteMediaArtifact(
    "https://example.com/a.png",
    async () => {
      throw new Error("network failed");
    },
    2,
    {},
  );
  assert.equal(artifact, null);
});
