/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveAttachmentBindCommandId,
  deriveInteractionCommandId,
  deriveStopCommandId,
  deriveTurnCommandId,
} from "../src/lifecycle/turn-command-id.js";

test("turn command ids are derived from their protocol source", () => {
  assert.equal(deriveTurnCommandId("client-turn:a"), "client-turn:a");
  assert.equal(deriveStopCommandId("client-turn:a"), "stop:client-turn:a");
  assert.equal(deriveInteractionCommandId("req-1"), "interaction:req-1");
  assert.equal(deriveAttachmentBindCommandId("client-turn:a"), "client-turn:a:attachments.bind");
});

test("turn command id derivation rejects a missing source", () => {
  assert.throws(() => deriveTurnCommandId(""), /turn_command_id_requires_turn_scope_id/);
  assert.throws(() => deriveStopCommandId(undefined), /stop_command_id_requires_turn_scope_id/);
  assert.throws(
    () => deriveInteractionCommandId(" "),
    /interaction_command_id_requires_request_id/,
  );
  assert.throws(
    () => deriveAttachmentBindCommandId(""),
    /attachment_bind_command_id_requires_turn_scope_id/,
  );
});
