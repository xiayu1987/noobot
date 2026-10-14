/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  buildClosePseudoPanelRoute,
  buildSessionPseudoRoute,
} from "../../../src/app/routing/appShellRoutePayload.js";

describe("appShellRoutePayload", () => {
  it("builds normalized route payloads for sessions and panels", () => {
    expect(buildSessionPseudoRoute(" session-1 ")).toEqual({ sessionId: "session-1", panel: "" });
    expect(buildClosePseudoPanelRoute()).toEqual({ panel: "" });
  });
});
