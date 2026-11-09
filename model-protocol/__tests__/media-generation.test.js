/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeModelOperation,
  normalizeModelOperationResult,
  normalizeGeneratedMediaArtifact,
  resolveModelGenerationApiType,
  requireModelGenerationSize,
  describeImageGenerationSizes,
} from "../src/index.js";

function operation(outputType, options = {}) {
  return normalizeModelOperation({
    kind: "media_generation",
    input: { prompt: "bird", outputType },
    options,
  });
}

test("native media operation requires explicit output type and rejects mixed modality parameters", () => {
  assert.throws(() => operation(undefined), /outputType/);
  assert.throws(
    () => operation("image", { duration: 5 }),
    /unsupported image generation option: duration/,
  );
  assert.throws(() => operation("video", { n: 2 }), /unsupported video generation option: n/);
  assert.throws(() => operation("video", { duration: 1.5 }), /positive integer/);
  assert.throws(() => operation("video", { aspectRatio: "landscape" }), /width:height/);
  assert.throws(() => operation("image", { imageUrls: [""] }), /non-empty/);
  const request = operation("video", { duration: 5, aspectRatio: "16:9" });
  assert.equal(request.options.duration, 5);
  assert.ok(Object.isFrozen(request.options.imageUrls));
});

test("native media results have exactly one explicit artifact source and supported MIME", () => {
  const artifact = {
    fileName: "a.mp4",
    mimeType: "video/mp4",
    url: "https://cdn.example.test/a.mp4",
  };
  const result = normalizeModelOperationResult("media_generation", {
    artifacts: [artifact],
    taskId: "t",
  });
  assert.equal(result.artifacts[0].mimeType, "video/mp4");
  assert.ok(Object.isFrozen(result.artifacts[0]));
  assert.throws(
    () => normalizeModelOperationResult("media_generation", { artifacts: [] }),
    /non-empty/,
  );
  assert.throws(
    () => normalizeGeneratedMediaArtifact({ ...artifact, contentBase64: "AQ==" }),
    /exactly one/,
  );
  assert.throws(
    () => normalizeGeneratedMediaArtifact({ ...artifact, url: "file:///tmp/x" }),
    /HTTP/,
  );
  assert.throws(
    () => normalizeGeneratedMediaArtifact({ ...artifact, mimeType: "application/octet-stream" }),
    /MIME/,
  );
  assert.throws(
    () => normalizeGeneratedMediaArtifact({ ...artifact, b64Json: "AQ==" }),
    /unsupported/,
  );
});

test("generation API selection has one explicit model declaration without legacy defaults", () => {
  assert.throws(() => resolveModelGenerationApiType({}), /unsupported model generation API/);
  for (const api_type of ["images_async", "openai_responses", "unknown"]) {
    assert.throws(
      () =>
        resolveModelGenerationApiType({
          multimodal_generation: { support_generation: { api_type } },
        }),
      /unsupported/,
    );
  }
});

test("image size validation and tool guidance share the selected API contract", () => {
  const contracts = [
    ["openai_images", ["auto", "1024x1024"], ["1:1", "0x1024", "2K"]],
    ["xai_images", ["1:1", "16:9"], ["auto", "1024x1024", "0:1"]],
    ["gemini_interactions", ["1:1", "16:9"], ["auto", "1024x1024", "1:0"]],
    ["gemini_generate_content", ["1:1", "16:9"], ["auto", "1024x1024"]],
    ["dashscope_multimodal", ["1024x1024", "1024*1024", "2K"], ["auto", "1:1", "0x1"]],
  ];
  for (const [apiType, valid, invalid] of contracts) {
    assert.ok(describeImageGenerationSizes().includes(apiType));
    for (const size of valid)
      assert.doesNotThrow(() => requireModelGenerationSize(apiType, operation("image", { size })));
    for (const size of invalid)
      assert.throws(
        () => requireModelGenerationSize(apiType, operation("image", { size })),
        /size must be/,
      );
    assert.doesNotThrow(() => requireModelGenerationSize(apiType, operation("image")));
  }
  assert.throws(
    () =>
      requireModelGenerationSize(
        "dashscope_multimodal",
        operation("image", { size: "2K", resolution: "2K" }),
      ),
    /not both/,
  );
  assert.throws(
    () =>
      requireModelGenerationSize("dashscope_multimodal", operation("image", { resolution: "1:1" })),
    /size must be/,
  );
  assert.throws(() => requireModelGenerationSize("unknown", operation("image")), /unsupported/);
  assert.doesNotThrow(() => requireModelGenerationSize("xai_video", operation("video")));
});

test("the protocol forbids retries for billable media submissions", async () => {
  const { normalizeRetryPolicy } = await import("../src/index.js");
  assert.equal(normalizeRetryPolicy({}, "media_generation").transport.maxAttempts, 1);
  assert.throws(
    () => normalizeRetryPolicy({ transport: { maxAttempts: 3 } }, "media_generation"),
    /cannot be retried/,
  );
  assert.throws(
    () =>
      normalizeGeneratedMediaArtifact({
        fileName: "x.png",
        mimeType: "image/png",
        contentBase64: "corrupt!",
      }),
    /valid padded base64/,
  );
});
