/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rotatedPluginLogName, isRotatedPluginLogName } from "../src/log-artifact.js";

test("plugin writer and audit reader share the rotated JSONL naming contract", () => {
  const log = { name: "events", extension: ".jsonl" };
  const name = rotatedPluginLogName({
    ...log,
    timestamp: new Date("2026-11-13T06:50:15.370Z"),
    suffix: "identity",
  });
  assert.equal(name, "events.2026-11-13T06-50-15-370Z.identity.jsonl");
  assert.equal(isRotatedPluginLogName(name, log), true);
  assert.equal(isRotatedPluginLogName("prompts.2026.identity.jsonl", log), false);
  assert.equal(isRotatedPluginLogName("events.jsonl", log), false);
  assert.equal(isRotatedPluginLogName(`${name}.tmp`, log), false);
});
