/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_INSTANCE_PATH_ENV_KEYS,
  withoutRuntimeInstancePaths,
} from "../src/instance-paths.js";

test("instance path env keys are frozen and unique", () => {
  assert.ok(Object.isFrozen(RUNTIME_INSTANCE_PATH_ENV_KEYS));
  assert.equal(new Set(RUNTIME_INSTANCE_PATH_ENV_KEYS).size, RUNTIME_INSTANCE_PATH_ENV_KEYS.length);
});

test("withoutRuntimeInstancePaths drops every instance path and keeps the rest", () => {
  const inherited = Object.fromEntries(
    RUNTIME_INSTANCE_PATH_ENV_KEYS.map((key) => [key, `/real/${key}`]),
  );
  const source = { KEEP: "1", ...inherited };
  const env = withoutRuntimeInstancePaths(source);
  assert.deepEqual(env, { KEEP: "1" });
  assert.equal(source.NOOBOT_WORKSPACE_ROOT, "/real/NOOBOT_WORKSPACE_ROOT");
});
