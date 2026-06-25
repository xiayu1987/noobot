import test from "node:test";
import assert from "node:assert/strict";
import { mergeAttachmentMetas } from "../src/capabilities/handlers/shared/attachment-log-utils.js";

test("mergeAttachmentMetas promotes duplicate attachment metadata to plugin ownership", () => {
  const merged = mergeAttachmentMetas(
    [
      {
        attachmentId: "report-1",
        name: "harness-acceptance-report.txt",
        path: "/runtime/report.txt",
      },
    ],
    [
      {
        attachmentId: "report-1",
        name: "harness-acceptance-report.txt",
        path: "/runtime/report.txt",
        owner: {
          type: "plugin",
          id: "harness-plugin",
        },
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].owner?.type, "plugin");
  assert.equal(merged[0].owner?.id, "harness-plugin");
});
