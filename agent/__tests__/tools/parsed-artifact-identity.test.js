/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { backwriteParsedAttachment } from "../../src/tools/core/parsed-artifact-persistence.js";
import {
  createTestRuntimeContext,
  createTestAttachmentService,
} from "../helpers/test-runtime-context.js";

const sourceIdentity = Object.freeze({
  attachmentId: "source",
  sessionId: "s-1",
  attachmentSource: "user",
});
const parsedAttachment = Object.freeze({
  identity: { attachmentId: "parsed", sessionId: "s-1", attachmentSource: "model" },
  name: "parsed.md",
  mimeType: "text/markdown",
});

for (const [field, code] of [
  ["turnScopeId", "invalid_attachment_turn_scope_id"],
  ["runId", "invalid_attachment_run_id"],
]) {
  for (const value of ["", "  ", " padded ", null, 42]) {
    test(`parsed attachment rejects ${field}=${JSON.stringify(value)} without committing a repaired event`, async () => {
      let commits = 0;
      const runtime = createTestRuntimeContext({
        attachmentService: createTestAttachmentService({
          async linkParsedResultToAttachment(request) {
            assert.equal(request.userId, runtime.systemRuntime.userId);
            return {
              ...sourceIdentity,
              relations: [
                {
                  relationType: "parsed_result",
                  sourceIdentity,
                  targetIdentity: parsedAttachment.identity,
                  createdAt: "2026-11-02T00:00:00.000Z",
                },
              ],
            };
          },
        }),
        sessionManager: {
          async commitAuthorityEvent() {
            commits += 1;
          },
        },
      });
      runtime.systemRuntime[field] = value;
      await assert.rejects(
        backwriteParsedAttachment({
          runtime,
          sourceAttachmentMeta: sourceIdentity,
          parsedAttachment,
        }),
        { code },
      );
      assert.equal(commits, 0);
    });
  }
}
