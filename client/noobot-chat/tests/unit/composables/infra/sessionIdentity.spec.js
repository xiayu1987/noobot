import { describe, expect, it } from "vitest";
import {
  buildSessionIdentityMap,
  findSessionByAnyId,
  normalizeSessionId,
  promoteSessionIdentityToBackendId,
} from "../../../../src/composables/infra/sessionIdentity";

describe("sessionIdentity", () => {
  it("normalizeSessionId trims invalid and empty values", () => {
    expect(normalizeSessionId("  s-1  ")).toBe("s-1");
    expect(normalizeSessionId("   ")).toBe("");
    expect(normalizeSessionId(null)).toBe("");
    expect(normalizeSessionId(undefined)).toBe("");
  });

  it("buildSessionIdentityMap indexes by id and backendSessionId", () => {
    const sessionA = { id: "local-1", backendSessionId: "backend-1" };
    const sessionB = { id: "backend-2", backendSessionId: "backend-2" };
    const map = buildSessionIdentityMap([sessionA, sessionB]);

    expect(map.get("local-1")).toBe(sessionA);
    expect(map.get("backend-1")).toBe(sessionA);
    expect(map.get("backend-2")).toBe(sessionB);
  });

  it("findSessionByAnyId resolves either local id or backend id", () => {
    const sessions = [
      { id: "local-1", backendSessionId: "backend-1" },
      { id: "backend-2", backendSessionId: "backend-2" },
    ];
    expect(findSessionByAnyId(sessions, "local-1")).toBe(sessions[0]);
    expect(findSessionByAnyId(sessions, "backend-1")).toBe(sessions[0]);
    expect(findSessionByAnyId(sessions, "backend-2")).toBe(sessions[1]);
    expect(findSessionByAnyId(sessions, "missing")).toBeNull();
  });

  it("promoteSessionIdentityToBackendId upgrades ids and active session id", () => {
    const session = { id: "local-1", backendSessionId: "local-1", isLocal: true };
    const result = promoteSessionIdentityToBackendId({
      sessionItem: session,
      backendSessionId: "backend-1",
      activeSessionId: "local-1",
    });

    expect(session.id).toBe("backend-1");
    expect(session.backendSessionId).toBe("backend-1");
    expect(session.isLocal).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.nextActiveSessionId).toBe("backend-1");
  });
});
