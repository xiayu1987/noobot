/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createSessionPersistenceScope, validateSessionPersistenceScope } from "../src/index.js";

test("Session persistence scope is the canonical immutable routing DTO", () => {
  const source = {
    scopeId: " agent:turn-1 ",
    parentSessionId: " root-session ",
    relativeDir: " runtime/agent/session/child-session ",
    allowedRoot: " runtime/agent/session ",
  };
  const validation = validateSessionPersistenceScope(source);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.scope, createSessionPersistenceScope(source));
  assert.equal(Object.isFrozen(validation.scope), true);
  assert.equal(validation.scope.scopeId, "agent:turn-1");
});

test("Session persistence scope rejects incomplete and alternate routing shapes", () => {
  assert.deepEqual(validateSessionPersistenceScope(null), {
    valid: true,
    errors: [],
    scope: null,
  });
  assert.deepEqual(
    validateSessionPersistenceScope({ scopeId: "agent:turn-1", legacyPath: "runtime/legacy" })
      .errors,
    ["unknown_persistence_scope_field", "incomplete_persistence_scope"],
  );
});
