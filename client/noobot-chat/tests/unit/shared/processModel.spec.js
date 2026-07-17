/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  createProcessEventFromLog,
  createProcessSnapshotFromLogs,
} from "../../../src/shared/process/aggregator";
import {
  applyProcessEvents,
  createEmptyProcessState,
  hydrateProcessSnapshot,
  selectProcessCompatView,
} from "../../../src/shared/process/reducer";
import {
  PROCESS_EVENT_VERSION,
  ProcessEventSource,
  resolveExplicitProcessTimestamp,
} from "../../../src/shared/process/protocol";

describe("process model", () => {
  it("normalizes seq into unified ProcessEvent metadata", () => {
    const event = createProcessEventFromLog(
      {
        seq: 7,
        dialogProcessId: "dialog-1",
        sessionId: "session-1",
        event: "tool_call",
        text: "read_file",
        ts: "2026-06-22T00:00:00.000Z",
      },
      { source: ProcessEventSource.STREAM },
    );

    expect(event).toMatchObject({
      version: PROCESS_EVENT_VERSION,
      sequence: 7,
      processId: "dialog-1",
      meta: {
        sequence: 7,
        version: PROCESS_EVENT_VERSION,
        processId: "dialog-1",
        sessionId: "session-1",
        source: ProcessEventSource.STREAM,
      },
    });
    expect(event.eventId).toBeTruthy();
    expect(event.payload.node.processId).toBe("dialog-1");
  });

  it("applies events by sequence and ignores duplicate eventId", () => {
    const state = createEmptyProcessState();
    const later = createProcessEventFromLog(
      { sequence: 2, dialogProcessId: "dialog-2", event: "tool_result", text: "second" },
      { eventId: "same-event", source: ProcessEventSource.STREAM },
    );
    const earlier = createProcessEventFromLog(
      { sequence: 1, dialogProcessId: "dialog-2", event: "tool_call", text: "first" },
      { source: ProcessEventSource.STREAM },
    );
    const duplicateLater = { ...later };

    applyProcessEvents(state, [later, duplicateLater, earlier]);
    const view = selectProcessCompatView(state, "dialog-2");

    expect(view.lastSequence).toBe(2);
    expect(view.executionLogTotal).toBe(2);
    expect(view.completedToolLogs.map((item) => item.text)).toEqual([
      "开始：执行命令：first",
      "完成：执行命令：second",
    ]);
  });

  it("hydrates snapshot and exposes compat view fields", () => {
    const state = createEmptyProcessState();
    const snapshot = createProcessSnapshotFromLogs({
      processId: "dialog-3",
      logs: [
        { event: "tool_call", text: "read_file", seq: 1 },
        { event: "tool_result", text: "ok", seq: 2 },
      ],
    });

    hydrateProcessSnapshot(state, snapshot);
    const view = selectProcessCompatView(state, "dialog-3");

    expect(view.lastSequence).toBe(2);
    expect(view.executionLogTotal).toBe(2);
    expect(view.realtimeLogs).toHaveLength(2);
    expect(view.completedToolLogs[1].text).toBe("完成：执行命令：ok");
  });

  it("keeps eventId stable for equivalent logs without explicit timestamp", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
      const firstEvent = createProcessEventFromLog(
        { sequence: 1, dialogProcessId: "dialog-stable", event: "tool_call", text: "same" },
        { source: ProcessEventSource.STREAM },
      );
      vi.setSystemTime(new Date("2026-06-22T00:00:01.000Z"));
      const secondEvent = createProcessEventFromLog(
        { sequence: 1, dialogProcessId: "dialog-stable", event: "tool_call", text: "same" },
        { source: ProcessEventSource.STREAM },
      );

      expect(resolveExplicitProcessTimestamp({})).toBe("");
      expect(firstEvent.eventId).toBe(secondEvent.eventId);
      expect(firstEvent.timestamp).toBe("2026-06-22T00:00:00.000Z");
      expect(secondEvent.timestamp).toBe("2026-06-22T00:00:01.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses fallback sequence for stable node id when stream log has no explicit sequence", () => {
    const event = createProcessEventFromLog(
      { dialogProcessId: "dialog-fallback", event: "tool_call", text: "cmd-1" },
      { source: ProcessEventSource.STREAM, fallbackSequence: 13 },
    );

    expect(event.sequence).toBe(13);
    expect(event.payload.node.id).toBe("dialog-fallback:seq:13");
  });
});
