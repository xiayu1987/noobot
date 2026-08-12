/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { parseJsonLines } from "../../e2e/protocol/helpers/persistence-audit.js";

describe("parseJsonLines", () => {
  it("reads only newline-committed frames from an active JSONL segment", () => {
    expect(parseJsonLines('{"seq":1}\n{"seq":', { committedFramesOnly: true })).toEqual([
      { seq: 1 },
    ]);
  });

  it("keeps strict validation for malformed committed frames", () => {
    expect(() => parseJsonLines(
      '{"seq":1}\nnot-json\n{"seq":2}\n',
      { committedFramesOnly: true },
    )).toThrow(SyntaxError);
  });

  it("parses a complete final frame when reading a closed JSONL artifact", () => {
    expect(parseJsonLines('{"seq":1}', { committedFramesOnly: false })).toEqual([{ seq: 1 }]);
  });
});
