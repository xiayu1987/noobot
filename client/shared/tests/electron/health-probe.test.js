/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { probeHealth } from "../../electron/runtime/health-probe.js";
import { createFixture } from "./desktop-service-fixture.js";

test("health probe distinguishes expected startup states and rejects malformed responses", async () => {
  const url = "http://127.0.0.1/health";
  for (const ok of [true, false]) {
    assert.deepEqual(await probeHealth(url, async () => Response.json({ ok })), {
      state: ok ? "ready" : "not_ready",
    });
  }
  assert.deepEqual(
    await probeHealth(url, async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    }),
    { state: "connection_refused" },
  );
  for (const fetchImpl of [
    async () => Response.json({ status: "ok" }),
    async () => new Response("invalid JSON"),
    async () => new Response("", { status: 401 }),
    async () => {
      throw new Error("unexpected failure");
    },
  ]) {
    await assert.rejects(probeHealth(url, fetchImpl), (error) => {
      assert.match(error.message, /HEALTH_PROBE_FAILED/);
      assert.ok(error.cause);
      return true;
    });
  }
});

test("invalid health response rejects startup before spawning a backend", async () => {
  const fixture = await createFixture({
    managerOptions: { fetchImpl: async () => new Response("invalid JSON") },
  });
  try {
    await assert.rejects(fixture.manager.ensureServiceStarted(), /HEALTH_PROBE_FAILED/);
    assert.equal(fixture.calls.length, 0);
  } finally {
    fixture.manager.stopManagedService();
    await fixture.restore();
  }
});
