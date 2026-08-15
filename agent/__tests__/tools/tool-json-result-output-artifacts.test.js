/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildToolResultPayload,
  parseToolOutputArtifacts,
} from "../../src/tools/core/tool-json-result.js";

test("failed tool results use one required result shape", () => {
  assert.deepEqual(buildToolResultPayload({ ok: false, message: "blocked" }), {
    ok: false,
    message: "blocked",
    status: "failed",
    error: "blocked",
    code: "RECOVERABLE_TOOL_ERROR",
  });
  assert.deepEqual(
    buildToolResultPayload({
      ok: false,
      status: "denied",
      error: "out of scope",
      code: "RECOVERABLE_PATH_OUT_OF_SCOPE",
    }),
    {
      ok: false,
      status: "denied",
      error: "out of scope",
      code: "RECOVERABLE_PATH_OUT_OF_SCOPE",
    },
  );
  assert.deepEqual(
    buildToolResultPayload({
      ok: false,
      code: 1,
      stderr: "path is outside the declared input scope\n",
    }),
    {
      ok: false,
      status: "failed",
      error: "path is outside the declared input scope",
      code: 1,
      stderr: "path is outside the declared input scope\n",
    },
  );
});

test("output artifact types have one strict representation", () => {
  assert.deepEqual(
    parseToolOutputArtifacts({
      outputArtifacts: [
        {
          type: "attachment_url",
          name: "image-url.txt",
          mimeType: "text/plain",
          content: "https://example.test/image.png",
        },
      ],
    })[0],
    {
      type: "attachment_url",
      name: "image-url.txt",
      mimeType: "text/plain",
      content: "https://example.test/image.png",
    },
  );

  assert.deepEqual(
    parseToolOutputArtifacts({
      outputArtifacts: [
        {
          type: "attachment_bytes",
          name: "image.png",
          mimeType: "image/png",
          contentBase64: "AQID",
        },
      ],
    })[0].type,
    "attachment_bytes",
  );

  assert.deepEqual(
    parseToolOutputArtifacts({
      outputArtifacts: [
        {
          type: "attachment_bytes",
          name: "empty.bin",
          mimeType: "application/octet-stream",
          contentBase64: "",
        },
      ],
    })[0],
    {
      type: "attachment_bytes",
      name: "empty.bin",
      mimeType: "application/octet-stream",
      contentBase64: "",
    },
  );

  assert.throws(
    () =>
      parseToolOutputArtifacts({
        outputArtifacts: [
          {
            type: "attachment_bytes",
            name: "image.png",
            mimeType: "image/png",
            contentBase64: "not-base64",
          },
        ],
      }),
    /invalid_tool_output_artifact_bytes/,
  );
  assert.throws(
    () =>
      parseToolOutputArtifacts({
        outputArtifacts: [
          {
            name: "missing-type.txt",
            mimeType: "text/plain",
            content: "x",
          },
        ],
      }),
    /invalid_tool_output_artifact_type/,
  );
});
