/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { terminalResolutionMetadata } from "../../../../../../src/modules/chat/runtime/terminalResolutionMetadata.js";

describe("terminalResolutionMetadata", () => {
  it("normalizes nested raw.turn metadata and the seq alias", () => {
    expect(terminalResolutionMetadata({
      raw: {
        commandId: " command-1 ",
        turn: {
          completionCommitId: " commit-1 ",
          summaryVersion: "4",
          revision: "5",
          seq: "6",
        },
      },
    })).toEqual({
      commandId: "command-1",
      completionCommitId: "commit-1",
      summaryVersion: 4,
      revision: 5,
      sequence: 6,
    });
  });

  it("gives turn fields precedence and filters invalid version metadata", () => {
    expect(terminalResolutionMetadata({
      commandId: "top-command",
      completionCommitId: "top-commit",
      summaryVersion: 1,
      revision: 2,
      sequence: 3,
      raw: { sequence: 4 },
      turn: {
        commandId: "turn-command",
        completionCommitId: "turn-commit",
        summaryVersion: 7,
        revision: -1,
        sequence: "not-a-number",
      },
    })).toEqual({
      commandId: "turn-command",
      completionCommitId: "turn-commit",
      summaryVersion: 7,
    });
  });
});
