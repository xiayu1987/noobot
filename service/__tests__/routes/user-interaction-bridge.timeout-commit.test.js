/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { flushJsonLineBatches } from "@noobot/runtime-events";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createUserInteractionBridge } from "../../ws/chat-websocket/user-interaction-bridge.js";
import { findPendingInteraction } from "../../ws/chat-websocket/pending-interaction-registry.js";
import {
  withRuntimeEventsRoot,
  initializeUserRuntimeDirectories,
  persistSession,
} from "../runtime-events-root.test-helpers.js";

for (const commitFails of [false, true]) {
  test(`interaction timeout reports only committed facts (commitFails=${commitFails})`, () =>
    withRuntimeEventsRoot("noobot-interaction-timeout-", async (workspaceRoot) => {
      await initializeUserRuntimeDirectories(workspaceRoot, "user-1");
      await persistSession(workspaceRoot, "user-1", {
        sessionId: "session-1",
        parentSessionId: "",
        caller: SESSION_CALLER.USER,
      });
      const commitError = new Error("terminal storage unavailable");
      const commits = [];
      const { userInteractionBridge } = createUserInteractionBridge({
        ownerUserId: "user-1",
        interactionTimeoutMs: 1,
        translateText: () => "interaction timed out",
        async commitInteractionRequest(request) {
          commits.push(request);
          if (request.payload.lifecycle === "failed" && commitFails) throw commitError;
          return { identity: { eventId: `event-${commits.length}` } };
        },
      });
      const request = userInteractionBridge.requestUserInteraction({
        interactionId: "timeout-contract",
        toolName: "user_interaction",
        authority: {
          session: { userId: "user-1", sessionId: "session-1", parentSessionId: "" },
          turn: { dialogProcessId: "dialog-1", turnScopeId: "turn-1" },
          persistenceScope: null,
        },
      });
      await assert.rejects(request, (error) => {
        if (commitFails) {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.cause, commitError);
          assert.equal(error.errors[0], commitError);
          assert.equal(error.errors[1].message, "interaction timed out");
        } else {
          assert.equal(error.message, "interaction timed out");
        }
        return true;
      });
      assert.equal(commits.length, 2);
      assert.equal(
        findPendingInteraction({
          ownerUserId: "user-1",
          requestId: commits[0].payload.requestId,
        }),
        null,
      );
      await flushJsonLineBatches();
      const records = [];
      for await (const file of fs.glob("**/*.jsonl", { cwd: workspaceRoot })) {
        const contents = await fs.readFile(path.join(workspaceRoot, file), "utf8");
        records.push(...contents.trim().split("\n").filter(Boolean).map(JSON.parse));
      }
      const events = records.map((record) => record.event);
      assert.equal(events.includes("service.websocket.interaction.terminalSent"), false);
      assert.equal(
        events.includes("service.websocket.interaction.terminalCommitted"),
        !commitFails,
      );
      assert.equal(
        events.includes("service.websocket.interaction.terminalCommitFailed"),
        commitFails,
      );
    }));
}
