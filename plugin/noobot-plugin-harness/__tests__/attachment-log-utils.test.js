import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeAttachments,
} from "../src/capabilities/handlers/shared/attachment-log-utils.js";
import { containsExecutableScriptText } from "../src/capabilities/handlers/shared/script-content-risk.js";

test("containsExecutableScriptText recognizes executable script signals only", () => {
  assert.equal(containsExecutableScriptText("```bash\nrm -rf /tmp/demo\n```"), true);
  assert.equal(containsExecutableScriptText("说明代码函数 foo() 的用途"), false);
});

test("mergeAttachments promotes duplicate attachment metadata to plugin ownership", () => {
  const merged = mergeAttachments(
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
