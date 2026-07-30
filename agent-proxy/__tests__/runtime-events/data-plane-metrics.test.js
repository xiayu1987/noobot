/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeAgentProxyDataPlaneMetricsEvent } from "../../src/runtime-events/ws-runtime-events.js";

test("data-plane success metrics write directly to system runtime events", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agent-proxy-data-plane-metrics-"));
  const eventFile = path.join(
    workspaceRoot,
    "system",
    "runtime",
    "events",
    "system",
    "agent-proxy",
    "transport.jsonl",
  );

  try {
    const result = await writeAgentProxyDataPlaneMetricsEvent({
      workspaceRoot,
      metrics: {
        windowStartedAtMs: 100,
        windowEndedAtMs: 200,
        upstreamMessages: 2,
        channelEvents: 2,
        broadcasts: 2,
        deliveries: 1,
      },
    });

    assert.equal(result.ok, true);
    const records = (await readFile(eventFile, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const record = records.find((item) => item.event === "agentProxy.dataPlane.success.summary");

    assert.ok(record);
    assert.equal(record.scope, "system");
    assert.equal(record.channel, "process");
    assert.equal(record.sessionId, undefined);
    assert.equal(record.data.upstreamMessages, 2);
    assert.equal(record.data.deliveries, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
