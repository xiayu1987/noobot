/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildAttachmentContentBlock } from "../../src/models/attachment/formatter.js";

test("buildAttachmentContentBlock supports container call style", () => {
  const block = buildAttachmentContentBlock({
    attachment: {
      type: "image/png",
      mimeType: "image/png",
      data: "data:image/png;base64,abc",
    },
  });
  assert.equal(block?.type, "image_url");
  assert.equal(block?.image_url?.url, "data:image/png;base64,abc");
});

test("buildAttachmentContentBlock uses canonical input_audio data", () => {
  const block = buildAttachmentContentBlock({
    attachment: {
      type: "audio/mpeg",
      mimeType: "audio/mpeg",
      data: "ZmFrZS1iYXNlNjQ=",
    },
  });
  assert.equal(block?.type, "input_audio");
  assert.equal(block?.input_audio?.format, "mp3");
  assert.equal(block?.input_audio?.data, "ZmFrZS1iYXNlNjQ=");
});

test("buildAttachmentContentBlock extracts base64 from an audio data URL", () => {
  const block = buildAttachmentContentBlock({
    attachment: {
      type: "audio/wav",
      mimeType: "audio/wav",
      data: "data:audio/wav;base64,QUJD",
    },
  });
  assert.equal(block?.type, "input_audio");
  assert.equal(block?.input_audio?.format, "wav");
  assert.equal(block?.input_audio?.data, "QUJD");
});

test("buildAttachmentContentBlock uses input_audio for openai_compatible", () => {
  const block = buildAttachmentContentBlock({
    attachment: {
      type: "audio/mpeg",
      mimeType: "audio/mpeg",
      data: "ZmFrZS1iYXNlNjQ=",
    },
  });
  assert.equal(block?.type, "input_audio");
  assert.equal(block?.input_audio?.format, "mp3");
  assert.equal(block?.input_audio?.data, "ZmFrZS1iYXNlNjQ=");
});
