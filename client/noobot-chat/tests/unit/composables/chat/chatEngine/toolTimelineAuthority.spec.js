/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  buildToolTimelineFromLegacyLogs,
  fillMissingToolTimelineFacets,
  mergeToolTimelines,
  reduceToolTimeline,
  TOOL_SEQUENCE_DOMAIN,
  TOOL_TIMELINE_AUTHORITY,
} from "../../../../../src/composables/chat/chatEngine/toolTimeline";
import {
  isToolActivityLog,
  mergeActivityTimelines,
  reduceActivityTimeline,
} from "../../../../../src/composables/chat/chatEngine/activityTimeline";

const authoritativeEnvelope = (overrides = {}) => ({
  eventId: "evt-end",
  eventType: "tool_call_end",
  sequence: 2,
  timestamp: "2026-07-25T03:36:09.000Z",
  tool: "read_file",
  toolCallId: "call-1",
  result: { ok: false },
  success: false,
  ...overrides,
});

describe("tool timeline authority", () => {
  it("marks message and transport sequence domains explicitly", () => {
    const authoritative = reduceToolTimeline([], authoritativeEnvelope(), {
      eventType: "tool_call_end",
      type: "tool_result",
      toolCallId: "call-1",
      text: "failed",
    });
    const compatibility = buildToolTimelineFromLegacyLogs([{
      event: "error",
      type: "tool_error",
      sequence: 39,
      toolCallId: "call-1",
      text: "tool_call_error missing",
    }], { sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT });

    expect(authoritative[0].resultEvent).toMatchObject({
      authority: TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE,
      sequenceDomain: TOOL_SEQUENCE_DOMAIN.MESSAGE,
      sequence: 2,
    });
    expect(compatibility[0].resultEvent).toMatchObject({
      authority: TOOL_TIMELINE_AUTHORITY.COMPATIBILITY,
      sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT,
      sequence: 39,
    });
  });

  it("uses legacy observations as fill-only and keeps canonical ordering identity", () => {
    const authoritative = reduceToolTimeline([], authoritativeEnvelope(), {
      eventType: "tool_call_end",
      type: "tool_result",
      toolCallId: "call-1",
      text: "canonical failure",
    });
    const compatibility = buildToolTimelineFromLegacyLogs([{
      event: "error",
      type: "tool_error",
      sequence: 39,
      toolCallId: "call-1",
      text: "duplicate transport failure",
      attachments: [{ attachmentId: "legacy-artifact" }],
    }], { sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT });

    const merged = fillMissingToolTimelineFacets(authoritative, compatibility);

    expect(merged).toHaveLength(1);
    expect(merged[0].resultEvent).toMatchObject({
      eventId: "evt-end",
      sequence: 2,
      authority: TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE,
      sequenceDomain: TOOL_SEQUENCE_DOMAIN.MESSAGE,
      log: expect.objectContaining({ text: "canonical failure" }),
      attachments: [{ attachmentId: "legacy-artifact" }],
    });
  });

  it("does not compare equal-authority sequence values across domains", () => {
    const transport = buildToolTimelineFromLegacyLogs([{
      event: "tool_result", sequence: 99, toolCallId: "call-1", text: "transport",
    }], { sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT });
    const persisted = buildToolTimelineFromLegacyLogs([{
      event: "tool_result", sequence: 1, toolCallId: "call-1", text: "persisted",
    }], { sequenceDomain: TOOL_SEQUENCE_DOMAIN.LEGACY });

    const merged = mergeToolTimelines(transport, persisted);

    expect(merged[0].resultEvent).toMatchObject({
      sequence: 1,
      sequenceDomain: TOOL_SEQUENCE_DOMAIN.LEGACY,
      log: expect.objectContaining({ text: "persisted" }),
    });
  });

  it("orders distinct cross-domain tool facts by timestamp", () => {
    const transport = buildToolTimelineFromLegacyLogs([{
      event: "tool_result",
      sequence: 999,
      timestamp: "2026-07-25T03:36:09.000Z",
      toolCallId: "transport-earlier",
      text: "transport",
    }], { sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT });
    const message = reduceToolTimeline([], authoritativeEnvelope({
      toolCallId: "message-later",
      sequence: 2,
      timestamp: "2026-07-25T03:36:10.000Z",
    }), { event: "tool_result", text: "message" });

    const merged = mergeToolTimelines(message, transport);

    expect(merged.map((item) => item.toolCallId)).toEqual([
      "transport-earlier",
      "message-later",
    ]);
  });

  it("keeps authoritative activity when a compatibility observation shares its identity", () => {
    const authoritative = {
      activityId: "event:shared",
      eventId: "shared",
      sequence: 2,
      authority: TOOL_TIMELINE_AUTHORITY.AUTHORITATIVE,
      sequenceDomain: TOOL_SEQUENCE_DOMAIN.MESSAGE,
      text: "canonical activity",
    };
    const compatibility = {
      ...authoritative,
      sequence: 999,
      authority: TOOL_TIMELINE_AUTHORITY.COMPATIBILITY,
      sequenceDomain: TOOL_SEQUENCE_DOMAIN.TRANSPORT,
      text: "transport duplicate",
    };

    expect(mergeActivityTimelines([authoritative], [compatibility])).toEqual([
      authoritative,
    ]);
  });

  it("rejects every toolCallId-bearing observation from activity timeline", () => {
    const toolError = {
      event: "error",
      type: "tool_error",
      sequence: 39,
      toolCallId: "call-1",
      text: "tool_call_error missing",
    };

    expect(isToolActivityLog(toolError)).toBe(true);
    expect(reduceActivityTimeline([], toolError)).toEqual([]);
  });
});
