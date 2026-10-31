/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { requireAgentDispatchAttachments } from "../src/index.js";

test("dispatch requires the canonical attachment field and complete identities", () => {
  const attachments = [{ attachmentId: "a1", sessionId: "s1", attachmentSource: "user" }];
  assert.equal(
    requireAgentDispatchAttachments({ userMessageAttachments: attachments }),
    attachments,
  );
  assert.deepEqual(requireAgentDispatchAttachments({ userMessageAttachments: [] }), []);
  assert.throws(() => requireAgentDispatchAttachments({}), /userMessageAttachments array/);
  assert.throws(
    () => requireAgentDispatchAttachments({ userMessageAttachments: [], attachments: [] }),
    /must use userMessageAttachments/,
  );
  assert.throws(() => requireAgentDispatchAttachments({ userMessageAttachments: [{}] }));
});
