/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_PROTOCOL_NAME,
  EVENT_PROTOCOL_VERSION,
  isLegacyEventEnvelope,
} from "../src/envelope.js";

test("isLegacyEventEnvelope flags flat and older-version envelopes", () => {
  assert.equal(isLegacyEventEnvelope({ protocolVersion: 4, eventId: "e1" }), true);
  assert.equal(
    isLegacyEventEnvelope({
      protocol: { name: EVENT_PROTOCOL_NAME, version: EVENT_PROTOCOL_VERSION - 1 },
    }),
    true,
  );
});

test("isLegacyEventEnvelope leaves current envelopes and non-objects to validation", () => {
  assert.equal(
    isLegacyEventEnvelope({
      protocol: { name: EVENT_PROTOCOL_NAME, version: EVENT_PROTOCOL_VERSION },
    }),
    false,
  );
  for (const value of [null, undefined, "x", 1, []]) {
    assert.equal(isLegacyEventEnvelope(value), false);
  }
});
