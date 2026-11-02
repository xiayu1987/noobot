/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

const PAYLOAD_BUDGET_BYTES = 4096;

test("receipt projections incur no snapshot reads once snapshots exceed the payload budget", () => {
  const runtimeParamsUrl = import.meta.resolve("@noobot/shared/runtime-params");
  const scenarioUrl = new URL("../helpers/receipt-cache-budget-scenario.js", import.meta.url).href;
  const script = `
    import { activateRuntimeParams } from ${JSON.stringify(runtimeParamsUrl)};
    activateRuntimeParams({
      schemaVersion: 1,
      revision: 0,
      overrides: { "length.artifact.verifiedSnapshotCacheBytes": ${PAYLOAD_BUDGET_BYTES} },
    });
    await import(${JSON.stringify(scenarioUrl)});
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});
