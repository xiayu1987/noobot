import test from "node:test";
import assert from "node:assert/strict";

import {
  createTurnCommand,
  resolveRunTurnScopeId,
  toCommitTurnPayload,
} from "../../../src/system-core/bot-manage/execution/turn-command.js";

test("turn command keeps existing-session context separate from continue action", () => {
  const send = createTurnCommand({
    userId: "u1", sessionId: "s1", dialogProcessId: "dp", turnScopeId: "turn",
    message: "next", runConfig: { idempotencyKey: "send-1" },
  });
  assert.equal(send.type, "send");
  assert.equal(send.sourceIdentity, null);

  const continued = createTurnCommand({
    userId: "u1", sessionId: "s1", dialogProcessId: "dp-new", turnScopeId: "turn-new",
    message: "continue", runConfig: {
      resumeFromStoppedSnapshot: true,
      resumeDialogProcessId: "dp-old",
      resumeTurnScopeId: "turn-old",
    },
  });
  const payload = toCommitTurnPayload(continued);
  assert.equal(payload.action, "continue");
  assert.equal(payload.resumeDialogProcessId, "dp-old");
  assert.equal(payload.resumeTurnScopeId, "turn-old");
  assert.equal(continued.type, "continue");
  assert.deepEqual(continued.sourceIdentity, { dialogProcessId: "dp-old", turnScopeId: "turn-old" });
});

test("turn command separates external user turns from backend-owned internal runs", () => {
  assert.match(resolveRunTurnScopeId({ caller: "user" }), /^server-turn:/);
  const internalTurnScopeId = resolveRunTurnScopeId({ caller: "bot" });
  assert.match(internalTurnScopeId, /^internal-turn:/);

  const internal = createTurnCommand({
    userId: "u1",
    sessionId: "child-session",
    dialogProcessId: "child-dialog",
    turnScopeId: internalTurnScopeId,
    message: "parse content",
    caller: "bot",
  });
  const payload = toCommitTurnPayload(internal);
  assert.equal(internal.origin, "internal");
  assert.equal(payload.frontendUserMessage, false);
});
