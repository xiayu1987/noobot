/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionCrudService } from "../../src/session/services/session-crud-service.js";

test("terminal query rejects malformed identity before repository access", async () => {
  const service = new SessionCrudService({ sessionRepo: {}, sessionTreeService: {} });
  let reads = 0;
  service.getSessionBundle = async () => {
    reads += 1;
    throw new Error("unexpected repository access");
  };
  for (const field of ["commandId", "sessionId", "turnScopeId"]) {
    for (const value of [undefined, null, 42, "", " padded "]) {
      const input = {
        userId: "user",
        commandId: "read",
        sessionId: "s1",
        turnScopeId: "turn-1",
        [field]: value,
      };
      const before = structuredClone(input);
      await assert.rejects(service.resolveTurnTerminalState(input), TypeError);
      assert.deepEqual(input, before);
    }
  }
  assert.equal(reads, 0);
});
