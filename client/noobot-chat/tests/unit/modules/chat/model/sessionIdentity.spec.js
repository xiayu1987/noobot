/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  buildSessionIdentityMap,
  confirmSessionIdentity,
  findSessionByAnyId,
  normalizeSessionId,
} from "../../../../../src/modules/chat/model/sessionIdentity.js";

describe("sessionIdentity", () => {
  it("normalizeSessionId trims invalid and empty values", () => {
    expect(normalizeSessionId("  s-1  ")).toBe("s-1");
    expect(normalizeSessionId("   ")).toBe("");
    expect(normalizeSessionId(null)).toBe("");
    expect(normalizeSessionId(undefined)).toBe("");
  });

  it("buildSessionIdentityMap indexes only by sessionId", () => {
    const sessionA = { sessionId: "session-1" };
    const sessionB = { sessionId: "session-2" };
    const map = buildSessionIdentityMap([sessionA, sessionB]);

    expect(map.get("session-1")).toBe(sessionA);
    expect(map.get("session-2")).toBe(sessionB);
    expect(map.size).toBe(2);
  });

  it("findSessionByAnyId resolves the unique sessionId", () => {
    const sessions = [
      { sessionId: "session-1" },
      { sessionId: "session-2" },
    ];
    expect(findSessionByAnyId(sessions, "session-1")).toBe(sessions[0]);
    expect(findSessionByAnyId(sessions, "session-2")).toBe(sessions[1]);
    expect(findSessionByAnyId(sessions, "missing")).toBeNull();
  });

  it("confirmSessionIdentity persists an unchanged preallocated identity", () => {
    const session = { sessionId: "session-1", isLocal: true };
    const result = confirmSessionIdentity({
      sessionItem: session,
      sessionId: "session-1",
      activeSessionId: "session-1",
    });

    expect(session.sessionId).toBe("session-1");
    expect(session.isLocal).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.nextActiveSessionId).toBe("session-1");
  });

  it("confirmSessionIdentity rejects a different identity", () => {
    expect(() => confirmSessionIdentity({
      sessionItem: { sessionId: "session-1", isLocal: true },
      sessionId: "session-2",
      activeSessionId: "session-1",
    })).toThrow("session identity mismatch");
  });
});
