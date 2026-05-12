import test from "node:test";
import assert from "node:assert/strict";

import { buildAttachmentContentBlock } from "../../../system-core/model/attachment/formatter.js";

test("buildAttachmentContentBlock supports container call style", () => {
  const block = buildAttachmentContentBlock({
    attachment: {
      type: "image/png",
      mimeType: "image/png",
      data: "data:image/png;base64,abc",
    },
    providerFormat: "dashscope",
  });
  assert.equal(block?.type, "image");
});
