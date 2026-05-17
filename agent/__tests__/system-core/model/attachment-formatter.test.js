import test from "node:test";
import assert from "node:assert/strict";

import { buildAttachmentContentBlock } from "../../../src/system-core/model/attachment/formatter.js";

test("buildAttachmentContentBlock supports container call style", () => {
  const block = buildAttachmentContentBlock({
    attachment: {
      type: "image/png",
      mimeType: "image/png",
      data: "data:image/png;base64,abc",
    },
    providerFormat: "dashscope",
  });
  assert.equal(block?.type, "image_url");
  assert.equal(block?.image_url?.url, "data:image/png;base64,abc");
});

test("buildAttachmentContentBlock uses input_audio data-url for dashscope", () => {
  const block = buildAttachmentContentBlock({
    attachment: {
      type: "audio/mpeg",
      mimeType: "audio/mpeg",
      data: "ZmFrZS1iYXNlNjQ=",
    },
    providerFormat: "dashscope",
  });
  assert.equal(block?.type, "input_audio");
  assert.equal(block?.input_audio?.format, "mp3");
  assert.equal(block?.input_audio?.data, "data:audio/mpeg;base64,ZmFrZS1iYXNlNjQ=");
});

test("buildAttachmentContentBlock keeps audio data-url for dashscope", () => {
  const block = buildAttachmentContentBlock({
    attachment: {
      type: "audio/wav",
      mimeType: "audio/wav",
      data: "data:audio/wav;base64,QUJD",
    },
    providerFormat: "dashscope",
  });
  assert.equal(block?.type, "input_audio");
  assert.equal(block?.input_audio?.format, "wav");
  assert.equal(block?.input_audio?.data, "data:audio/wav;base64,QUJD");
});

test("buildAttachmentContentBlock uses input_audio for openai_compatible", () => {
  const block = buildAttachmentContentBlock({
    attachment: {
      type: "audio/mpeg",
      mimeType: "audio/mpeg",
      data: "ZmFrZS1iYXNlNjQ=",
    },
    providerFormat: "openai_compatible",
  });
  assert.equal(block?.type, "input_audio");
  assert.equal(block?.input_audio?.format, "mp3");
  assert.equal(block?.input_audio?.data, "ZmFrZS1iYXNlNjQ=");
});
