/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createContextScope,
  createContextSourceSnapshot,
  projectContextSource,
} from "../src/index.js";

test("context source projection excludes only the active canonical scope", () => {
  const source = createContextSourceSnapshot({
    messages: [
      { role: "user", content: "old", dialogProcessId: "d-old", turnScopeId: "t-old" },
      { role: "user", content: "active", dialogProcessId: "d-active", turnScopeId: "t-active" },
      { role: "assistant", content: "current dialog", dialogProcessId: "d-active", turnScopeId: "t-other" },
    ],
  });
  const projection = projectContextSource({
    source,
    scope: createContextScope({ sessionId: "s", dialogProcessId: "d-active", turnScopeId: "t-active" }),
  });
  assert.equal(projection.messages.length, 1);
  assert.equal(projection.messages[0].content, "old");
  assert.equal(projection.sourceRevision, source.revision);
});

test("source revision is deterministic and changes when authoritative data changes", () => {
  const first = createContextSourceSnapshot({ messages: [{ role: "user", content: "a" }] });
  const same = createContextSourceSnapshot({ messages: [{ role: "user", content: "a" }] });
  const changed = createContextSourceSnapshot({ messages: [{ role: "user", content: "b" }] });
  assert.equal(first.revision, same.revision);
  assert.notEqual(first.revision, changed.revision);
});
