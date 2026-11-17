/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { recordServiceAgentTransportDebug } from "../../runtime-events/agent-transport-debug.js";
import { createProtocolTestCommand } from "../routes/chat-websocket-server.test-helpers.js";
import {
  withRuntimeEventsRoot,
  withRuntimeEventsEnv,
} from "../runtime-events-root.test-helpers.js";

test("transport diagnostics retain requested identity without requiring or creating a session", () =>
  withRuntimeEventsRoot("noobot-transport-diagnostics-", async (workspaceRoot) => {
    await withRuntimeEventsEnv({ debug: { agentTransport: true } }, async () => {
      const command = createProtocolTestCommand({
        sessionId: "unregistered-session",
        turnScopeId: "requested-turn",
        message: "private business content",
        createIfAbsent: true,
      });
      const events = [
        "service.agentTransport.commandReceived",
        "service.agentTransport.commandConsumed",
        "service.agentTransport.commandDispatchFailed",
        "service.agentTransport.commandRejected",
      ];
      for (const event of events) {
        const result = await recordServiceAgentTransportDebug({
          event,
          command,
          userId: "owner",
        });
        assert.equal(result.ok, true);
        assert.notEqual(result.skipped, true);
        assert.equal(result.record.scope, "system");
        assert.equal(result.record.sessionId, command.identity.sessionId);
        assert.equal(result.record.turnScopeId, command.identity.turnScopeId);
        assert.equal(result.record.data.commandId, command.commandId);
        assert.equal(result.record.data.messageLength, command.input.message.length);
        assert.equal(JSON.stringify(result.record).includes(command.input.message), false);
        assert.equal(
          result.file.startsWith(path.join(workspaceRoot, "owner", "runtime", "events", "system")),
          true,
        );
      }
      await assert.rejects(fs.stat(path.join(workspaceRoot, "owner", "runtime", "session")), {
        code: "ENOENT",
      });
    });
  }));
