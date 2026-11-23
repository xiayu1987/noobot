/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { workflowSessionSnapshotEventId } from "@noobot/event-protocol/workflow-runtime-event";
import { WORKFLOW_SESSION_REQUEST_ERROR_CODE } from "@noobot/event-protocol/workflow-session-detail";
import {
  createWorkflowServiceRouteHandlers,
  WORKFLOW_ROUTE_ERROR_CODE,
} from "../../src/service/routes.js";

const HTTP_STATUS = Object.freeze({ BAD_REQUEST: 400, NOT_FOUND: 404 });

function createHandlers(sessionOverrides = {}) {
  return createWorkflowServiceRouteHandlers({
    ports: {
      http: { status: HTTP_STATUS },
      sessions: {
        readSnapshot: async () => {
          throw new Error("unexpected snapshot read");
        },
        readThinkingDetail: async () => ({ exists: true }),
        releaseThinkingDetail: async () => {
          throw new Error("unexpected snapshot release");
        },
        readExecutionReport: async () => null,
        ...sessionOverrides,
      },
    },
  });
}

function request(query) {
  return {
    params: { userId: "user-1", sessionId: "root-session", dialogProcessId: "dialog-1" },
    query,
    locale: "en",
  };
}

function response() {
  const result = { body: null };
  const res = new Writable();
  res.json = (body) => {
    result.body = body;
    res.end();
  };
  return { result, res };
}

test("rejects non-canonical query values as invalid", async () => {
  const handlers = createHandlers();
  for (const value of [" dialog-1", "", ["dialog-1"]]) {
    await assert.rejects(
      handlers["workflow.execution-report"](request({ dialogProcessId: value }), response().res),
      { code: WORKFLOW_SESSION_REQUEST_ERROR_CODE.INVALID, statusCode: 400 },
    );
  }
});

test("rejects absent required query values as required", async () => {
  const handlers = createHandlers();
  await assert.rejects(handlers["workflow.execution-report"](request({}), response().res), {
    code: WORKFLOW_SESSION_REQUEST_ERROR_CODE.REQUIRED,
    statusCode: 400,
  });
});

test("thinking-detail passes the Turn lookup key to the host port unmodified", async () => {
  const received = [];
  const handlers = createHandlers({
    readThinkingDetail: async (input) => {
      received.push(input);
      return { exists: true };
    },
  });
  const { result, res } = response();
  await handlers["workflow.thinking-detail"](
    request({
      turnScopeId: "turn-1",
      dialogProcessId: "dialog-2",
      nodeSessionId: "node-1",
      limit: "1",
      cursor: JSON.stringify({ scope: "snapshot", after: 1 }),
    }),
    res,
  );
  assert.equal(received.length, 1);
  assert.equal(received[0].turnScopeId, "turn-1");
  assert.equal(received[0].dialogProcessId, "dialog-2");
  assert.equal(received[0].authoritySessionId, "root-session");
  assert.equal(received[0].sessionId, "node-1");
  assert.equal(received[0].limit, 1);
  assert.deepEqual(received[0].cursor, { scope: "snapshot", after: 1 });
  assert.deepEqual(received[0].segments.slice(-1), ["dialog-1"]);
  assert.equal(result.body.dialogProcessId, "dialog-1");
});

test("thinking page rejects invalid transport before calling the host reader", async () => {
  let reads = 0;
  const handlers = createHandlers({
    readThinkingDetail: async () => {
      reads += 1;
    },
  });
  for (const invalid of [
    { cursor: "{" },
    { cursor: ["null", "null"] },
    { limit: ["1"] },
    { limit: "1e1" },
    { limit: undefined },
  ]) {
    await assert.rejects(
      handlers["workflow.thinking-detail"](
        request({
          turnScopeId: "turn-1",
          dialogProcessId: "dialog-2",
          nodeSessionId: "node-1",
          limit: "1",
          ...invalid,
        }),
        response().res,
      ),
      { code: "SESSION_PAGE_REQUEST_INVALID", statusCode: 400 },
    );
  }
  assert.equal(reads, 0);
});

test("thinking release validates transport and forwards the node capability to the host", async () => {
  const received = [];
  const handlers = createHandlers({
    releaseThinkingDetail: async (selection) => {
      received.push(selection);
      return { released: true };
    },
  });
  const cursor = { after: 1, scope: JSON.stringify(["retained-token", "snapshot"]) };
  const query = {
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-2",
    nodeSessionId: "node-1",
    cursor: JSON.stringify(cursor),
  };
  const { result, res } = response();
  await handlers["workflow.thinking-detail-release"](request(query), res);
  assert.deepEqual(received, [
    {
      userId: "user-1",
      authoritySessionId: "root-session",
      sessionId: "node-1",
      dialogProcessId: "dialog-2",
      turnScopeId: "turn-1",
      cursor,
      segments: ["session", "root-session", "dialog-1"],
      locale: "en",
    },
  ]);
  assert.deepEqual(result.body, { ok: true, released: true });
  for (const invalid of [undefined, "null", "{", [JSON.stringify(cursor)]]) {
    await assert.rejects(
      handlers["workflow.thinking-detail-release"](request({ ...query, cursor: invalid }), res),
      {
        code: "SESSION_PAGE_REQUEST_INVALID",
        statusCode: 400,
      },
    );
  }
  assert.equal(received.length, 1);
});

test("reports a missing execution report as not found", async () => {
  const handlers = createHandlers();
  await assert.rejects(
    handlers["workflow.execution-report"](request({ dialogProcessId: "dialog-1" }), response().res),
    { code: WORKFLOW_ROUTE_ERROR_CODE.REPORT_NOT_FOUND, statusCode: 404 },
  );
});

test("builds the snapshot eventId through the protocol factory", async () => {
  const handlers = createHandlers({
    readSnapshot: async () => ({
      sessionSummary: {
        sessionId: "child-session",
        parentSessionId: "root-session",
        updatedAt: "2026-08-19T00:00:00.000Z",
        aggregateVersion: 3,
        messages: [],
        turnLifecycleSnapshot: createTurnLifecycleSnapshot({
          activeTurnScopeId: "",
          activeTurn: null,
          recentTerminalTurns: [],
          replacedTurns: [],
          unchanged: false,
          recovery: "none",
          commandId: "snapshot:child-session:3",
          sessionId: "child-session",
          sequence: 3,
          generatedAt: "2026-08-19T00:00:00.000Z",
        }),
        turnTimings: [],
      },
      executionLogs: [],
      meta: {
        workflowRunId: "run-1",
        nodeExecutionId: "node-1",
        turnScopeId: "workflow-node:node-1",
        executionId: "agent:node-1",
      },
    }),
  });
  const { result, res } = response();
  await handlers["workflow.detail"](request({ traceId: "trace-1" }), res);
  const { workflowSession } = result.body;
  assert.equal(
    workflowSession.snapshotEnvelope.identity.eventId,
    workflowSessionSnapshotEventId({ nodeSessionId: "child-session", aggregateVersion: 3 }),
  );
  assert.equal(workflowSession.snapshotEnvelope.occurredAt, "2026-08-19T00:00:00.000Z");
  assert.equal(workflowSession.snapshotEnvelope.payload.nodeSessionId, "child-session");
  for (const field of ["sessionId", "parentSessionId", "aggregateVersion", "updatedAt"]) {
    assert.equal(Object.hasOwn(workflowSession.snapshotEnvelope.payload, field), false, field);
  }
  assert.deepEqual(Object.keys(workflowSession).sort(), ["executionLogs", "snapshotEnvelope"]);
});
