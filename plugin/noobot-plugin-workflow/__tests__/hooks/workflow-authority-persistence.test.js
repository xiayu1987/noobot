/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEventEnvelope } from "@noobot/event-protocol/envelope";
import { getEventFamily } from "@noobot/event-protocol";
import test from "node:test";
import assert from "node:assert/strict";

import { commitWorkflowRuntimeEvent } from "../../src/core/hooks/authority-event-commit.js";

test("workflow authority commit uses the protocol persistence scope", async () => {
  const commits = [];
  const events = [];
  const persistenceScope = Object.freeze({
    scopeId: "agent:workflow-node-1",
    parentSessionId: "root-session",
    relativeDir: "runtime/plugin-data/workflow/session/child-session/node-1",
    allowedRoot: "runtime/plugin-data/workflow/session",
  });
  let envelope = null;
  const ctx = {
    userId: "user-1",
    sessionId: "child-session",
    eventListener: {
      async onEvent(event) {
        events.push(event);
      },
    },
    agentContext: {
      bindings: {
        runtime: {
          userId: "user-1",
          systemRuntime: { persistenceScope },
          sessionManager: {
            async commitAuthorityEvent(payload) {
              commits.push(payload);
              envelope = createEventEnvelope({
                family: payload.family,
                schemaVersion: getEventFamily(payload.family).schemaVersion,
                identity: {
                  ...payload.identity,
                  eventId: "workflow-event-1",
                  sessionId: payload.sessionId,
                },
                causality: payload.causality,
                ordering: { ...payload.ordering, sequence: 1 },
                producer: payload.producer,
                occurredAt: "2026-10-22T00:00:00.000Z",
                payload: payload.payload,
              });
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
    commandId: "command-1",
    payload: { workflowRunId: "workflow-run-1", turnScopeId: "turn-child-1" },
    orderingDomain: "workflow",
    orderingScopeId: "workflow-run-1",
  });

  assert.equal(result, envelope);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].persistenceScope, persistenceScope);
  assert.equal(commits[0].identity.turnScopeId, "turn-child-1");
  assert.equal(commits[0].userId, "user-1");
  assert.deepEqual(commits[0].causality, {
    commandId: "command-1",
    correlationId: "workflow-run-1",
  });
  assert.equal("persistenceContext" in commits[0], false);
  assert.equal(events[0].data.persistenceScope, persistenceScope);

  await assert.rejects(
    commitWorkflowRuntimeEvent({
      ctx: {
        ...ctx,
        agentContext: {
          bindings: {
            runtime: {
              ...ctx.agentContext.bindings.runtime,
              runConfig: { commandId: "runtime-command" },
            },
          },
        },
      },
      eventType: "workflow_node_state_committed",
      payload: { workflowRunId: "workflow-run-1", turnScopeId: "turn-child-1" },
    }),
    /workflow authority event commandId is required/,
  );
  assert.equal(commits.length, 1);
});
