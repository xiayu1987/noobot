/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isModelContextTraceEnabled,
} from "../../../../src/system-core/agent/core/message-context/context-diagnostics.js";

function withArgv(argv = [], fn = () => {}) {
  const originalArgv = process.argv;
  process.argv = ["node", "test", ...argv];
  try {
    return fn();
  } finally {
    process.argv = originalArgv;
  }
}

describe("context diagnostics", () => {
  it("keeps model context trace disabled by default", () => {
    withArgv([], () => {
      assert.equal(isModelContextTraceEnabled(), false);
    });
  });

  it("allows runtime config to enable model context trace", () => {
    assert.equal(isModelContextTraceEnabled({ modelContextTrace: true }), true);
    assert.equal(isModelContextTraceEnabled({ systemRuntime: { modelContextTrace: "enabled" } }), true);
  });

  it("allows argv to enable model context trace", () => {
    withArgv(["--model-context-trace"], () => {
      assert.equal(isModelContextTraceEnabled(), true);
    });
  });

  it("allows explicit config and argv to disable model context trace", () => {
    assert.equal(isModelContextTraceEnabled({ modelContextTrace: false }), false);
    withArgv(["--no-model-context-trace"], () => {
      assert.equal(isModelContextTraceEnabled(), false);
    });
  });
});
