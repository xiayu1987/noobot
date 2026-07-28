/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { applyReconnectEnvelopeToTargetMessage } from "../../../../../../src/modules/chat/runtime/reconnect/batchReplay.js";
import { normalizeReplayError } from "../../../../../../src/modules/chat/runtime/reconnect/utils.js";
import { StreamEventEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";

describe("reconnect replay error normalization", () => {
  it("extracts readable error details from replay values", () => {
    expect(normalizeReplayError({ message: "对话已被用户停止" })).toBe("对话已被用户停止");
    expect(normalizeReplayError("  run aborted  ")).toBe("run aborted");
    expect(normalizeReplayError(null)).toBe("");
  });

  it("does not render an object error as [object Object]", () => {
    const targetMessage = { error: "", pending: true };

    const applied = applyReconnectEnvelopeToTargetMessage({
      envelope: {
        event: StreamEventEnum.ERROR,
        data: { error: { message: "对话已被用户停止" } },
      },
      targetMessage,
      normalizedDpId: "dp-error",
      terminalDialogProcessIdSet: new Set(),
    });

    expect(applied).toBe(true);
    expect(targetMessage.error).toBe("对话已被用户停止");
    expect(targetMessage.error).not.toBe("[object Object]");
  });
});
