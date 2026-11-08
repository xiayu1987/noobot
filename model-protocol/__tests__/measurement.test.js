/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_REQUEST_EVENT,
  MODEL_USAGE_FIELDS,
  createUnavailableModelUsage,
  requireModelRequestMeasurement,
  requireModelResponseTerminal,
  resolveModelStreamTerminal,
  unavailableMeasurement,
} from "../src/index.js";

const identity = {
  transportRequestId: "request-1",
  attempt: 1,
  invocation: { invocationId: "invocation-1" },
};

test("stream terminal status is independent of final output usage availability", () => {
  for (const type of ["response.incomplete", "response.failed"])
    assert.deepEqual(
      resolveModelStreamTerminal("responses", {
        type,
        response: { status: type.slice("response.".length) },
      }),
      {
        status: "failed",
        outputUsageFinal: true,
      },
    );
  for (const [format, event] of [
    ["anthropic", { type: "error" }],
    ["chat", { error: { message: "failed" } }],
  ])
    assert.deepEqual(resolveModelStreamTerminal(format, event), {
      status: "failed",
      outputUsageFinal: false,
    });
  for (const [format, type] of [["responses", "response.completed"]])
    assert.deepEqual(
      resolveModelStreamTerminal(format, { type, response: { status: "completed", output: [] } }),
      {
        status: "completed",
        outputUsageFinal: true,
      },
    );
  assert.equal(resolveModelStreamTerminal("anthropic", { type: "message_delta" }), null);
  assert.equal(resolveModelStreamTerminal("anthropic", { type: "message_stop" }), null);
  assert.equal(resolveModelStreamTerminal("chat", { type: "[DONE]" }), null);
  assert.equal(resolveModelStreamTerminal("responses", { type: "[DONE]" }), null);
  assert.equal(resolveModelStreamTerminal(null, { type: "error" }), null);
});

test("Responses completion requires an output array in bodies and terminal events", () => {
  for (const output of [undefined, null, {}, "text", 7]) {
    const response = { status: "completed", output };
    assert.throws(() => requireModelResponseTerminal("responses", response), /output array/);
    assert.throws(
      () => resolveModelStreamTerminal("responses", { type: "response.completed", response }),
      /output array/,
    );
  }
  assert.equal(
    requireModelResponseTerminal("responses", { status: "completed", output: [] }).status,
    "completed",
  );
});

test("Responses completion rejects a non-null error in bodies and terminal events", () => {
  for (const error of [
    { code: "server_error", message: "conflict" },
    {},
    "conflict",
    false,
    0,
    "",
  ]) {
    const response = { id: "resp_conflict", status: "completed", output: [], error };
    for (const validate of [
      () => requireModelResponseTerminal("responses", response),
      () => resolveModelStreamTerminal("responses", { type: "response.completed", response }),
    ])
      assert.throws(validate, (failure) => {
        assert.equal(failure.name, "ModelProtocolError");
        assert.match(failure.message, /non-null error/);
        assert.equal(failure.details.responseId, response.id);
        assert.equal(failure.details.path, "error");
        return true;
      });
  }
  for (const error of [undefined, null]) {
    const response = { status: "completed", output: [], error };
    assert.equal(requireModelResponseTerminal("responses", response).status, "completed");
    assert.equal(
      resolveModelStreamTerminal("responses", { type: "response.completed", response }).status,
      "completed",
    );
  }
});

test("Responses output validates nested structures with a diagnostic path before completion", () => {
  for (const output of [
    [null],
    ["text"],
    [{}],
    [{ type: "message", content: null }],
    [{ type: "message", content: [null] }],
    [{ type: "message", content: [{ type: "output_text", text: "text", annotations: [null] }] }],
    [{ type: "reasoning", summary: [null] }],
  ]) {
    const response = { id: "resp_invalid", status: "completed", output };
    for (const validate of [
      () => requireModelResponseTerminal("responses", response),
      () => resolveModelStreamTerminal("responses", { type: "response.completed", response }),
    ])
      assert.throws(validate, (error) => {
        assert.equal(error.name, "ModelProtocolError");
        assert.equal(error.details.responseId, response.id);
        assert.ok(error.details.path.startsWith("output[0]"));
        return true;
      });
  }
});

test("Responses completion preserves valid text, refusal, reasoning and tool output", () => {
  const output = [
    {
      type: "message",
      content: [
        { type: "output_text", text: "", annotations: [] },
        {
          type: "output_text",
          text: "source",
          annotations: [{ type: "url_citation", url: "https://example.test", title: "source" }],
        },
        { type: "refusal", refusal: "Cannot comply" },
      ],
    },
    { type: "reasoning", summary: [] },
    { type: "reasoning", summary: [{ type: "summary_text", text: "Reasoning" }] },
    { type: "function_call", call_id: "call_test", name: "test", arguments: "{}" },
    { type: "web_search_call", status: "completed" },
    { type: "image_generation_call", result: "image" },
  ];
  const response = { status: "completed", output };
  const before = structuredClone(response);
  assert.equal(requireModelResponseTerminal("responses", response).status, "completed");
  assert.equal(
    resolveModelStreamTerminal("responses", { type: "response.completed", response }).status,
    "completed",
  );
  assert.deepEqual(response, before);
});

for (const key of MODEL_USAGE_FIELDS) {
  test(`request usage rejects diagnostic-free measurement_failed in ${key}`, () => {
    const usage = {
      ...createUnavailableModelUsage("provider_not_reported"),
      [key]: unavailableMeasurement("measurement_failed"),
    };
    assert.throws(
      () =>
        requireModelRequestMeasurement(MODEL_REQUEST_EVENT.USAGE, {
          ...identity,
          usage,
          measurementError: null,
        }),
      /requires measurementError diagnostic/,
    );
  });
}

test("request prefix cannot produce a diagnostic-free measurement_failed", () => {
  assert.throws(
    () =>
      requireModelRequestMeasurement(MODEL_REQUEST_EVENT.STARTED, {
        ...identity,
        prefix: unavailableMeasurement("measurement_failed"),
      }),
    /requires measurementError diagnostic/,
  );
});

test("measurement failure requires a diagnostic and excludes usage", () => {
  const valid = { ...identity, usage: null, measurementError: "invalid provider usage" };
  assert.equal(requireModelRequestMeasurement(MODEL_REQUEST_EVENT.USAGE, valid), valid);
  for (const data of [
    { ...valid, measurementError: null },
    { ...valid, measurementError: "" },
    { ...valid, usage: createUnavailableModelUsage("measurement_failed") },
    { ...valid, usage: createUnavailableModelUsage("provider_not_reported") },
  ])
    assert.throws(() => requireModelRequestMeasurement(MODEL_REQUEST_EVENT.USAGE, data));
});
