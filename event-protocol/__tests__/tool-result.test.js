/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_RESULT_ERROR,
  assertToolResultObject,
  decodeToolResultText,
  encodeToolResultObject,
  toolResultOverflow,
} from "../src/tool-result.js";

const rejects = (code) => (error) => error instanceof TypeError && error.code === code;

test("overflow results reject missing delivery and invalid transfer envelopes", () => {
  for (const validate of [
    assertToolResultObject,
    encodeToolResultObject,
    (value) => decodeToolResultText(JSON.stringify(value)),
  ]) {
    assert.throws(
      () => validate({ ok: true, overflowed: true, message: "read output" }),
      /tool_result_overflow_transfers_required/,
    );
    assert.throws(
      () => validate({ ok: true, overflowed: false }),
      /tool_result_overflow_flag_invalid/,
    );
    assert.throws(
      () =>
        validate({ ok: true, overflowed: true, message: "read output", transferEnvelopes: [{}] }),
      /invalid_transfer_envelope/,
    );
  }
  assert.throws(
    () => toolResultOverflow({ message: "read output", transferEnvelopes: [] }),
    /tool_result_overflow_transfers_required/,
  );
  assert.throws(
    () => toolResultOverflow({ message: "read output", transferEnvelopes: [{}] }),
    /invalid_transfer_envelope/,
  );
  assert.throws(
    () => toolResultOverflow({ message: "", transferEnvelopes: [{}] }),
    /tool_result_overflow_message_required/,
  );
});

test("tool result text decodes to a JSON object with a boolean ok", () => {
  assert.deepEqual(decodeToolResultText('{"ok":true,"path":"a.txt"}'), {
    ok: true,
    path: "a.txt",
  });
  assert.deepEqual(decodeToolResultText('{"ok":false,"error":"denied","code":"E_DENIED"}'), {
    ok: false,
    error: "denied",
    code: "E_DENIED",
  });
});

test("tool result text rejects every non-contract shape", () => {
  assert.throws(() => decodeToolResultText({ ok: true }), rejects(TOOL_RESULT_ERROR.NOT_TEXT));
  assert.throws(() => decodeToolResultText("plain text"), rejects(TOOL_RESULT_ERROR.NOT_JSON));
  assert.throws(() => decodeToolResultText(""), rejects(TOOL_RESULT_ERROR.NOT_JSON));
  assert.throws(() => decodeToolResultText("[]"), rejects(TOOL_RESULT_ERROR.NOT_OBJECT));
  assert.throws(() => decodeToolResultText('"ok"'), rejects(TOOL_RESULT_ERROR.NOT_OBJECT));
  assert.throws(() => decodeToolResultText("{}"), rejects(TOOL_RESULT_ERROR.OK_NOT_BOOLEAN));
  assert.throws(
    () => decodeToolResultText('{"ok":"true"}'),
    rejects(TOOL_RESULT_ERROR.OK_NOT_BOOLEAN),
  );
});

test("failed tool results must carry a non-empty error and a text error code", () => {
  const failure = (fields) => () => assertToolResultObject({ ok: false, ...fields });
  assert.throws(failure({ code: "E" }), rejects(TOOL_RESULT_ERROR.FAILURE_ERROR_REQUIRED));
  assert.throws(
    failure({ error: " ", code: "E" }),
    rejects(TOOL_RESULT_ERROR.FAILURE_ERROR_REQUIRED),
  );
  assert.throws(
    failure({ error: 1, code: "E" }),
    rejects(TOOL_RESULT_ERROR.FAILURE_ERROR_REQUIRED),
  );
  assert.throws(failure({ error: "x" }), rejects(TOOL_RESULT_ERROR.FAILURE_CODE_REQUIRED));
  assert.throws(failure({ error: "x", code: "" }), rejects(TOOL_RESULT_ERROR.CODE_NOT_TEXT));
  assert.throws(failure({ error: "x", code: 1 }), rejects(TOOL_RESULT_ERROR.CODE_NOT_TEXT));
  assert.deepEqual(assertToolResultObject({ ok: false, error: "x", code: "E", exitCode: 2 }), {
    ok: false,
    error: "x",
    code: "E",
    exitCode: 2,
  });
});

test("code is reserved for text error codes on successful results too", () => {
  assert.throws(
    () => assertToolResultObject({ ok: true, code: 0 }),
    rejects(TOOL_RESULT_ERROR.CODE_NOT_TEXT),
  );
  assert.deepEqual(assertToolResultObject({ ok: true, exitCode: 0 }), { ok: true, exitCode: 0 });
});

test("tool result objects encode only when they satisfy the contract", () => {
  assert.equal(encodeToolResultObject({ ok: true }), '{"ok":true}');
  assert.throws(() => encodeToolResultObject(null), rejects(TOOL_RESULT_ERROR.NOT_OBJECT));
  assert.throws(() => assertToolResultObject({ ok: 1 }), rejects(TOOL_RESULT_ERROR.OK_NOT_BOOLEAN));
});
