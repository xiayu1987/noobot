/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logRuntimeRouteCompleted,
  logStreamEvent,
} from "../../../../../../src/modules/chat/runtime/engine/sendStreamEventRouter.js";
import { setStreamDeltaDebugLogSink } from "../../../../../../src/modules/debug/loggers/streamDeltaDebugLogger.js";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";

function createSink(enabled = true) {
  const records = [];
  return {
    records,
    isEnabled: (type) => enabled && type === "stream-delta",
    debug: (type, build) => records.push(build()),
  };
}

const delta = () =>
  canonicalMessageEvent({ eventType: "llm_delta", text: "chunk", eventId: "evt-delta" });
const durable = () =>
  canonicalMessageEvent({ eventType: "thinking", text: "done", eventId: "evt-thinking", sequence: 1 });
const entry = { category: "transport", event: "stream.message_event", sessionId: "s1", data: { seq: 0 } };
const routeArgs = (authoritativeEvent, routed) => ({
  routed,
  data: {},
  authoritativeEvent,
  authoritativeIdentity: authoritativeEvent.identity,
  authoritativePayload: authoritativeEvent.payload,
  sessionId: "s1",
  turnScopeId: "t1",
});

afterEach(() => setStreamDeltaDebugLogSink(null));

describe("stream event log routing", () => {
  it("sends transient delta entries to the stream-delta debug channel only", () => {
    const sink = createSink();
    setStreamDeltaDebugLogSink(sink);
    const logSessionEvent = vi.fn();
    logStreamEvent(entry, delta(), logSessionEvent);
    logRuntimeRouteCompleted({ ...routeArgs(delta(), true), logSessionEvent });
    expect(logSessionEvent).not.toHaveBeenCalled();
    expect(sink.records.map((record) => [record.debugType, record.event])).toEqual([
      ["stream-delta", "stream.message_event"],
      ["stream-delta", "frontend.runtimeStream.routeCompleted"],
    ]);
    expect(sink.records[0].sessionId).toBe("s1");
  });

  it("drops delta diagnostics when the stream-delta switch is off", () => {
    const sink = createSink(false);
    setStreamDeltaDebugLogSink(sink);
    const logSessionEvent = vi.fn();
    logStreamEvent(entry, delta(), logSessionEvent);
    expect(sink.records).toHaveLength(0);
    expect(logSessionEvent).not.toHaveBeenCalled();
  });

  it("keeps durable events in transport, never writes deltas there, and skips pass-through routes", () => {
    const sink = createSink();
    setStreamDeltaDebugLogSink(sink);
    const logSessionEvent = vi.fn();
    logStreamEvent(entry, durable(), logSessionEvent);
    logRuntimeRouteCompleted({ ...routeArgs(durable(), true), logSessionEvent });
    logRuntimeRouteCompleted({ ...routeArgs(durable(), false), logSessionEvent });
    logRuntimeRouteCompleted({ ...routeArgs(delta(), false), logSessionEvent });
    expect(sink.records).toHaveLength(0);
    expect(logSessionEvent.mock.calls.map(([record]) => [record.category, record.level || ""])).toEqual([
      ["transport", ""],
      ["transport", "info"],
    ]);
    expect(logSessionEvent.mock.calls.some(([record]) => record.level === "warn")).toBe(false);
  });
});
