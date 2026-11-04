/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyGeneratedMedia,
  fetchRemoteMediaArtifact,
  persistModelGeneratedArtifacts,
} from "../../../src/artifacts/runtime/artifact-service.js";

test("classifyGeneratedMedia extracts inline base64 media without storage metadata", () => {
  const { inlineCandidates: candidates } = classifyGeneratedMedia([
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

test("classification keeps remote URLs in content order", () => {
  assert.deepEqual(
    classifyGeneratedMedia([
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
      { type: "text", text: "ignored" },
      { type: "video_url", video_url: { url: "http://example.com/b.mp4" } },
    ]).remoteUrls,
    ["https://example.com/a.png", "http://example.com/b.mp4"],
  );
});

test("inline extraction preserves source priority and content-block numbering", () => {
  assert.deepEqual(
    classifyGeneratedMedia([
      { type: "text", text: "ignored" },
      { type: "image_url", image_url: { url: "https://example.com/remote.png" } },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
      {
        type: "video",
        source: { type: "base64", media_type: "video/mp4", data: "dmlkZW8=" },
        url: "data:image/png;base64,aW1hZ2U=",
      },
    ]).inlineCandidates,
    [
      {
        mediaType: "image",
        mimeType: "image/png",
        contentBase64: "aW1hZ2U=",
        fileName: "image_url_2.png",
      },
      {
        mediaType: "video",
        mimeType: "video/mp4",
        contentBase64: "dmlkZW8=",
        fileName: "video_3.mp4",
      },
    ],
  );
});

test("persistence fetches media concurrently and ingests in content order with canonical ownership", async () => {
  const requests = [];
  const pending = [];
  const ingestions = [];
  const events = [];
  const records = [{ attachmentId: "generated-1" }];
  const saving = persistModelGeneratedArtifacts({
    aiContent: [
      { type: "image_url", image_url: { url: "https://example.com/first.png" } },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW5saW5l" } },
      { type: "video_url", video_url: { url: "https://example.com/second.mp4" } },
    ],
    runtime: {
      systemRuntime: { userId: "user-1", sessionId: "session-1", turnScopeId: "turn-1" },
      sharedTools: {
        fetch(url) {
          requests.push(url);
          return new Promise((resolve) => pending.push(resolve));
        },
      },
      attachmentService: {
        async ingestGeneratedArtifacts(input) {
          ingestions.push(input);
          return records;
        },
      },
    },
    dialogProcessId: "dialog-1",
    modelMessageId: "model-1",
    eventListener: { onEvent: (event) => events.push(event) },
  });
  assert.deepEqual(requests, ["https://example.com/first.png", "https://example.com/second.mp4"]);
  assert.equal(ingestions.length, 0);
  const response = (contentType, content) => ({
    ok: true,
    headers: { get: () => contentType },
    arrayBuffer: async () => Buffer.from(content),
  });
  pending[1](response("video/mp4", "second"));
  pending[0](response("image/png", "first"));
  assert.equal(await saving, records);
  assert.equal(ingestions.length, 1);
  const input = ingestions[0];
  assert.equal(input.userId, "user-1");
  assert.equal(input.sessionId, "session-1");
  assert.equal(input.attachmentSource, "model");
  assert.equal(input.dialogProcessId, "dialog-1");
  assert.equal(input.turnScopeId, "turn-1");
  assert.deepEqual(input.turnScope, { sessionId: "session-1", turnScopeId: "turn-1" });
  assert.deepEqual(input.owner, { type: "model", id: "model-1" });
  assert.deepEqual(
    input.artifacts.map(({ fileName }) => fileName),
    ["image_url_2.png", "generated_media_1.png", "generated_media_2.mp4"],
  );
  assert.deepEqual(
    input.artifacts.map(({ contentBase64 }) => contentBase64),
    ["aW5saW5l", Buffer.from("first").toString("base64"), Buffer.from("second").toString("base64")],
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "model_generated_attachments_saved");
  assert.equal(events[0].data.attachments, records);
});
