/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { ACTIVITY_KIND } from "@noobot/event-protocol/message-event";
import { reduceCanonicalActivityTimeline } from "@noobot/event-protocol/activity-timeline";
import { initializeAgentModelHost } from "../../src/runtime/model-port-host.js";
import {
  bindAssistantMessageEventStream,
  beginAssistantMessageEventStream,
} from "../../src/events/message-event-stream.js";
import { initializeCurrentTurnMessageEventProjection } from "../../src/events/current-turn-message-event-projection.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";
import { createCanonicalMessageEventSessionManager } from "../helpers/canonical-message-event-session-manager.js";

test("provider errors retry the same request and update one durable retry activity", async () => {
  const modes = [];
  const progress = [];
  const activities = [];
  const runtime = createTestRuntimeContext({
    sessionManager: createCanonicalMessageEventSessionManager({ producerId: "model-retry" }),
    eventListener: {
      onEvent({ event, data }) {
        if (event === "model.invocation.retry_scheduled") progress.push(data.retryCount);
        if (
          event === "authority_event_committed" &&
          data.envelope.payload.activityKind === ACTIVITY_KIND.MODEL_RETRY
        )
          activities.push(data.envelope);
      },
    },
    sharedTools: {
      fetch: async (_url, options) => {
        const body = JSON.parse(options.body);
        modes.push(body.stream === true);
        if (modes.length < 3)
          return Response.json(
            { error: { code: "vendor_extension", message: "provider failed" } },
            { status: 520 },
          );
        return Response.json({
          id: "chat-1",
          object: "chat.completion",
          model: body.model,
          choices: [
            { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
          ],
        });
      },
    },
  });
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: "p-1",
    parentSessionId: "",
    workflowNodeOwnership: null,
  });
  initializeCurrentTurnMessageEventProjection(runtime);
  beginAssistantMessageEventStream(runtime, { turn: 0 });
  const { modelPort } = initializeAgentModelHost({
    runtime,
    invocationIdentity: {
      sessionId: "s-1",
      parentSessionId: "",
      dialogProcessId: "d-1",
      turnScopeId: "t-1",
      runId: "run-1",
    },
  });
  const response = await modelPort.invoke({
    messages: [],
    options: { streaming: false },
    policies: { retry: { maxTotalAttempts: 3, transport: { baseDelayMs: 0 } } },
    invocation: {
      flow: "test",
      purpose: "test",
      domain: "primary",
      contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
    },
  });
  assert.equal(response.output.text, "ok");
  assert.deepEqual(modes, [false, false, false]);
  assert.deepEqual(progress, [1, 2]);
  assert.equal(activities.length, 2);
  assert.equal(new Set(activities.map(({ payload }) => payload.activityId)).size, 1);
  const timeline = activities.reduce(reduceCanonicalActivityTimeline, []);
  assert.equal(timeline.length, 1);
  assert.match(timeline[0].text, /2\/2/);
});
