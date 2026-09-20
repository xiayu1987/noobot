/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { assertChunkBudgets } from "../../../build/chunk-budget.js";

function chunk(fileName, sizeKiB, options = {}) {
  return {
    type: "chunk",
    fileName,
    code: "x".repeat(sizeKiB * 1024),
    imports: [],
    isEntry: false,
    ...options,
  };
}

describe("JavaScript chunk budgets", () => {
  it("allows a large feature chunk when it is reachable only through a dynamic import", () => {
    const bundle = {
      "index.js": chunk("index.js", 300, {
        isEntry: true,
        dynamicImports: ["viewer.js"],
      }),
      "viewer.js": chunk("viewer.js", 3000, { isDynamicEntry: true }),
    };
    expect(() => assertChunkBudgets(bundle)).not.toThrow();
  });

  it("applies the initial budget to synchronous dependencies of an entry", () => {
    const bundle = {
      "index.js": chunk("index.js", 300, {
        isEntry: true,
        imports: ["shared.js"],
      }),
      "shared.js": chunk("shared.js", 501),
    };
    expect(() => assertChunkBudgets(bundle)).toThrow(
      /shared\.js: 501\.00 KiB exceeds initial limit 500 KiB/,
    );
  });

  it("rejects a deferred feature that exceeds its separate budget", () => {
    const bundle = {
      "index.js": chunk("index.js", 300, { isEntry: true }),
      "viewer.js": chunk("viewer.js", 3001, { isDynamicEntry: true }),
    };
    expect(() => assertChunkBudgets(bundle)).toThrow(
      /viewer\.js: 3001\.00 KiB exceeds deferred limit 3000 KiB/,
    );
  });
});
