/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TEST_RUNTIME_OVERRIDES_ENV } from "@noobot/shared/testing/runtime-params";

const PAYLOAD_BUDGET_BYTES = 4096;

test("receipt projections incur no snapshot reads once snapshots exceed the payload budget", () => {
  const scenarioPath = fileURLToPath(
    new URL("../helpers/receipt-cache-budget-scenario.js", import.meta.url),
  );
  const child = spawnSync(
    process.execPath,
    ["--import", import.meta.resolve("@noobot/shared/testing/runtime-params"), scenarioPath],
    {
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        [TEST_RUNTIME_OVERRIDES_ENV]: JSON.stringify({
          "length.artifact.verifiedSnapshotCacheBytes": PAYLOAD_BUDGET_BYTES,
        }),
      },
    },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});
