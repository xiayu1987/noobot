/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { isEventForCurrentTurn } from "../../../../../../src/modules/chat/runtime/engine/sendFlowSupport.js";
import { createTurnObservation } from "../../../../../../src/modules/chat/runtime/engine/turnObservation.js";

describe("turn routing identity", () => {
  it("does not match missing identities or repair a malformed event identity", () => {
    const message = { turnScopeId: "client-turn:one" };
    expect(isEventForCurrentTurn({}, {})).toBe(false);
    expect(isEventForCurrentTurn({}, message)).toBe(false);
    expect(isEventForCurrentTurn({ turnScopeId: " client-turn:one " }, message)).toBe(false);
    expect(isEventForCurrentTurn({ turnScopeId: "client-turn:two" }, message)).toBe(false);
    expect(isEventForCurrentTurn({ turnScopeId: "client-turn:one" }, message)).toBe(true);
  });

  it("keeps requested and observed session identities distinct", () => {
    expect(createTurnObservation({ requestedSessionId: "requested" })).toMatchObject({
      requestedSessionId: "requested",
      canonicalSessionId: "",
    });
  });
});
