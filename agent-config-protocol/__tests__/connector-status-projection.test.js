/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mergeConnectorStatusItems } from "../src/connector-status-projection.js";

test("runtime connector facts override history while preserving history metadata", () => {
  const result = mergeConnectorStatusItems({
    historyConnectors: [{ connector_name: "mail", connection_defaults: { folder: "INBOX" } }],
    runtimeConnectors: [{ connector_name: "mail", connected_at: "2026-01-01T00:00:00Z" }],
  });
  assert.equal(result[0].status, "connected");
  assert.deepEqual(result[0].connection_defaults, { folder: "INBOX" });
});
