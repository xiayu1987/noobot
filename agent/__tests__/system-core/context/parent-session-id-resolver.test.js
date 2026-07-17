/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveParentSessionId,
  resolveParentSessionIdWithMeta,
} from "../../../src/system-core/context/parent-session-id-resolver.js";

test("resolveParentSessionId prefers context.parentSessionId", () => {
  const resolved = resolveParentSessionId({
    context: { parentSessionId: "p-context" },
    runtime: { systemRuntime: { parentSessionId: "p-runtime" } },
  });
  assert.equal(resolved, "p-context");
});

test("resolveParentSessionId falls back to runtime.systemRuntime.parentSessionId", () => {
  const resolved = resolveParentSessionId({
    runtime: { systemRuntime: { parentSessionId: "p-runtime" } },
  });
  assert.equal(resolved, "p-runtime");
});

test("resolveParentSessionId no longer reads legacy agentContext.session.parent.id", () => {
  const resolved = resolveParentSessionId({
    agentContext: { session: { parent: { id: "p-agent-parent" } } },
  });
  assert.equal(resolved, "");
});

test("resolveParentSessionIdWithMeta returns source and legacy flag", () => {
  const resolved = resolveParentSessionIdWithMeta({
    runtime: { systemRuntime: { parentSessionId: "p-runtime" } },
  });
  assert.equal(resolved.value, "p-runtime");
  assert.equal(resolved.source, "options.runtime.systemRuntime.parentSessionId");
  assert.equal(resolved.legacy, false);
});
