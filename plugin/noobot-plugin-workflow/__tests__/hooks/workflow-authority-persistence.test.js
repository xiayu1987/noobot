/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { commitWorkflowRuntimeEvent } from "../../src/core/hooks/authority-event-commit.js";

test("workflow authority commit uses the protocol persistence scope", async () => {
  const commits = [];
  const events = [];
  const persistenceScope = Object.freeze({
    scopeId: "agent:workflow-node-1",
    parentSessionId: "root-session",
    relativeDir: "runtime/workflow/session/child-session/node-1",
    allowedRoot: "runtime/workflow/session",
  });
  const envelope = { identity: { eventId: "workflow-event-1" } };
  const ctx = {
    userId: "user-1",
    sessionId: "child-session",
    turnScopeId: "turn-child-1",
    eventListener: {
      async onEvent(event) {
        events.push(event);
      },
    },
    agentContext: {
      bindings: {
        runtime: {
          userId: "user-1",
          runConfig: { turnScopeId: "turn-child-1" },
          systemRuntime: { persistenceScope },
          sessionManager: {
            async commitAuthorityEvent(payload) {
              commits.push(payload);
              return { committed: true, envelope };
            },
          },
        },
      },
    },
  };

  const result = await commitWorkflowRuntimeEvent({
    ctx,
    eventType: "workflow_node_state_committed",
    payload: { workflowRunId: "workflow-run-1" },
    orderingDomain: "workflow",
    orderingScopeId: "workflow-run-1",
  });

  assert.equal(result, envelope);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].persistenceScope, persistenceScope);
  assert.equal("persistenceContext" in commits[0], false);
  assert.equal(events[0].data.persistenceScope, persistenceScope);
});
