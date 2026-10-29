/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ERROR_CODE,
  collectTurnLookupKeyErrors,
  createTurnArtifactRevision,
  matchesTurnLookupKey,
  requireTurnLookupKey,
} from "../src/index.js";

test("requireTurnLookupKey accepts exactly the identities turnOrder can hold", () => {
  const key = requireTurnLookupKey({ turnScopeId: "client-turn:1", dialogProcessId: "dp-1_a" });
  assert.deepEqual(key, { turnScopeId: "client-turn:1", dialogProcessId: "dp-1_a" });
  assert.equal(Object.isFrozen(key), true);
});

test("requireTurnLookupKey rejects missing, padded and malformed identities with 400", () => {
  const cases = [
    [null, ["turn_lookup_key_not_object"]],
    [{ dialogProcessId: "dp-1" }, ["missing_turn_scope_id"]],
    [{ turnScopeId: "scope-1" }, ["invalid_dialog_process_id"]],
    [{ turnScopeId: "scope-1", dialogProcessId: "" }, ["invalid_dialog_process_id"]],
    [{ turnScopeId: "scope-1", dialogProcessId: " dp-1 " }, ["invalid_dialog_process_id"]],
    [{ turnScopeId: "scope-1", dialogProcessId: "dp/1" }, ["invalid_dialog_process_id"]],
    [{ turnScopeId: " scope-1 ", dialogProcessId: "dp-1" }, ["non_canonical_turn_scope_id"]],
  ];
  for (const [input, errors] of cases) {
    assert.deepEqual(collectTurnLookupKeyErrors(input), errors);
    assert.throws(() => requireTurnLookupKey(input), {
      code: SESSION_ERROR_CODE.TURN_LOOKUP_KEY_INVALID,
      statusCode: 400,
    });
  }
});

test("matchesTurnLookupKey requires both identities to match", () => {
  const key = requireTurnLookupKey({ turnScopeId: "scope-1", dialogProcessId: "dp-1" });
  assert.equal(
    matchesTurnLookupKey({ turnScopeId: "scope-1", dialogProcessId: "dp-1" }, key),
    true,
  );
  assert.equal(
    matchesTurnLookupKey({ turnScopeId: "scope-1", dialogProcessId: "dp-2" }, key),
    false,
  );
  assert.equal(
    matchesTurnLookupKey({ turnScopeId: "scope-2", dialogProcessId: "dp-1" }, key),
    false,
  );
});

test("createTurnArtifactRevision is derived only from the committed journal position", () => {
  assert.equal(
    createTurnArtifactRevision({ turnId: "turn-000001", committedBytes: 42 }),
    "turn-journal:turn-000001:42",
  );
});
