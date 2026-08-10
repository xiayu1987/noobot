/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseToolOutputArtifacts } from "../../src/tools/core/tool-json-result.js";

test("output artifact types have one strict representation", () => {
  assert.deepEqual(parseToolOutputArtifacts({ outputArtifacts: [{
    type: "attachment_url",
    name: "image-url.txt",
    mimeType: "text/plain",
    content: "https://example.test/image.png",
  }] })[0], {
    type: "attachment_url",
    name: "image-url.txt",
    mimeType: "text/plain",
    content: "https://example.test/image.png",
  });

  assert.deepEqual(parseToolOutputArtifacts({ outputArtifacts: [{
    type: "attachment_bytes",
    name: "image.png",
    mimeType: "image/png",
    contentBase64: "AQID",
  }] })[0].type, "attachment_bytes");

  assert.throws(() => parseToolOutputArtifacts({ outputArtifacts: [{
    type: "attachment_bytes",
    name: "image.png",
    mimeType: "image/png",
    contentBase64: "not-base64",
  }] }), /invalid_tool_output_artifact_bytes/);
  assert.throws(() => parseToolOutputArtifacts({ outputArtifacts: [{
    name: "missing-type.txt",
    mimeType: "text/plain",
    content: "x",
  }] }), /invalid_tool_output_artifact_type/);
});
