/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTurnSnapshotCommand } from "@noobot/agent-transport-protocol";
import { TURN_SNAPSHOT_TERMINAL_LIMIT } from "@noobot/session-protocol/turn-lifecycle";
import { writeAgentTransportDebugEvent } from "../../src/runtime-events/agent-transport-debug-runtime-events.js";
import { createChannelKey, parseChannelKey } from "../../src/shared/utils.js";

test("reconnect snapshot forward event takes identity from channel key without socket", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agent-proxy-transport-events-"));
  const previousWorkspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  process.env.NOOBOT_WORKSPACE_ROOT = workspaceRoot;
  const key = createChannelKey({
    userId: "user-a",
    sessionId: "child-session",
    parentSessionId: "root-session",
  });
  const channel = { key, identity: parseChannelKey(key), ownerUserId: "" };
  const command = createTurnSnapshotCommand({
    commandId: "proxy-snapshot:child-session:test",
    identity: { sessionId: "child-session" },
    options: { knownSequence: 0, terminalLimit: TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT },
  });

  try {
    const result = await writeAgentTransportDebugEvent({
      event: "agentProxy.agentTransport.commandForwarded",
      command,
      channel,
      data: { forwarded: true, transport: "websocket" },
    });

    assert.equal(result.ok, true, String(result.error?.message || ""));
    assert.equal(result.record.scope, "session");
    assert.equal(result.record.userId, "user-a");
    assert.equal(result.record.sessionId, "child-session");
    assert.equal(result.record.parentSessionId, "root-session");
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.NOOBOT_WORKSPACE_ROOT;
    else process.env.NOOBOT_WORKSPACE_ROOT = previousWorkspaceRoot;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
