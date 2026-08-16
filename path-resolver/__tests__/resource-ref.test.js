/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createResourceRef, isResourceRef, projectResourceRef } from "../src/index.mjs";

test("resource refs have an opaque identity independent of path", () => {
  const first = createResourceRef({
    owner: "admin",
    logical: { view: "workspace", path: "a.txt" },
    capabilities: { read: true, scriptInput: true },
  });
  const second = createResourceRef({
    owner: "admin",
    logical: { view: "workspace", path: "a.txt" },
    capabilities: { read: true, scriptInput: true },
  });
  assert.notEqual(first.resourceId, second.resourceId);
  assert.equal(isResourceRef(first), true);
  assert.equal(projectResourceRef(first).resourceId, first.resourceId);
});

test("attachment refs require attachment identity and never become task paths", () => {
  const ref = createResourceRef({
    owner: "admin",
    source: "attachment",
    logical: { view: "attachment", path: "report.pdf" },
    attachment: { attachmentId: "a1", sessionId: "s1", attachmentSource: "user" },
    capabilities: { read: true, scriptInput: true },
  });
  assert.equal(ref.logical.view, "attachment");
  assert.equal(ref.resourceId.startsWith("res_"), true);
});
