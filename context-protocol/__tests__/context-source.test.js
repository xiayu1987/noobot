/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createContextScope, projectContextSource } from "../src/index.js";

test("context source projection excludes only the active canonical scope", () => {
  const projection = projectContextSource({
    source: {
      messages: [
        { role: "user", content: "old", dialogProcessId: "d-old", turnScopeId: "t-old" },
        { role: "user", content: "active", dialogProcessId: "d-active", turnScopeId: "t-active" },
        {
          role: "assistant",
          content: "current dialog",
          dialogProcessId: "d-active",
          turnScopeId: "t-other",
        },
      ],
      turnLifecycle: { turns: {} },
    },
    scope: createContextScope({
      dialogProcessId: "d-active",
      turnScopeId: "t-active",
    }),
  });
  assert.equal(projection.messages.length, 1);
  assert.equal(projection.messages[0].content, "old");
  assert.equal(Object.hasOwn(projection, "sourceRevision"), false);
});
