/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { anthropicMessagesAdapter, classifyTransportError } from "../src/index.js";
import { MODEL_ERROR_KIND } from "@noobot/model-protocol";

test("transport errors classify nested Undici timeouts as timeout", () => {
  const headersTimeout = new TypeError("fetch failed", {
    cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
  });
  assert.deepEqual(classifyTransportError(headersTimeout), {
    kind: MODEL_ERROR_KIND.TIMEOUT,
  });
  assert.deepEqual(
    anthropicMessagesAdapter.classifyError(headersTimeout, { operatorId: "anthropic" }),
    { kind: MODEL_ERROR_KIND.TIMEOUT },
  );
  assert.deepEqual(
    classifyTransportError({ name: "AbortError", code: "UND_ERR_HEADERS_TIMEOUT" }),
    { kind: MODEL_ERROR_KIND.ABORTED },
  );
});

test("transport errors classify body timeouts without treating termination as cancellation", () => {
  const bodyTimeout = new TypeError("terminated", {
    cause: { code: "UND_ERR_BODY_TIMEOUT" },
  });
  for (const failure of [bodyTimeout, bodyTimeout.cause]) {
    assert.deepEqual(classifyTransportError(failure), { kind: MODEL_ERROR_KIND.TIMEOUT });
    assert.deepEqual(anthropicMessagesAdapter.classifyError(failure, { operatorId: "anthropic" }), {
      kind: MODEL_ERROR_KIND.TIMEOUT,
    });
  }
  assert.deepEqual(classifyTransportError(new TypeError("terminated")), {
    kind: MODEL_ERROR_KIND.UNKNOWN,
  });
  assert.deepEqual(classifyTransportError({ name: "AbortError", cause: bodyTimeout }), {
    kind: MODEL_ERROR_KIND.ABORTED,
  });
});

test("transport errors classify temporary socket failures as temporary unavailable", () => {
  const socketFailure = new TypeError("fetch failed", {
    cause: { code: "ECONNRESET" },
  });
  assert.deepEqual(classifyTransportError(socketFailure), {
    kind: MODEL_ERROR_KIND.TEMPORARY_UNAVAILABLE,
  });
});
