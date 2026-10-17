/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { terminalResolutionMetadata } from "../../../../../../src/modules/chat/runtime/terminalResolutionMetadata.js";

describe("terminalResolutionMetadata", () => {
  it("normalizes top-level version metadata", () => {
    expect(
      terminalResolutionMetadata({
        completionCommitId: " commit-1 ",
        summaryVersion: "4",
        revision: "5",
        sequence: "6",
      }),
    ).toEqual({
      completionCommitId: "commit-1",
      summaryVersion: 4,
      revision: 5,
      sequence: 6,
    });
  });

  it("reads only the given object, never nested raw/turn or the seq alias", () => {
    expect(
      terminalResolutionMetadata({
        seq: 3,
        raw: { turn: { revision: 9, sequence: 9 } },
        turn: { completionCommitId: "turn-commit", summaryVersion: 7 },
      }),
    ).toEqual({});
  });

  it("filters invalid version metadata", () => {
    expect(
      terminalResolutionMetadata({
        completionCommitId: "commit",
        summaryVersion: 7,
        revision: -1,
        sequence: "not-a-number",
      }),
    ).toEqual({ completionCommitId: "commit", summaryVersion: 7 });
  });
});
