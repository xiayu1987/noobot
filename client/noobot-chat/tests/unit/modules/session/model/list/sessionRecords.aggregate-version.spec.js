/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  createLocalSessionItem,
  hasCurrentSessionDetail,
  isLoadedRemoteSession,
  mapSummaryEntryToSession,
  reconcileSessionObject,
  requireLoadedSessionDetail,
} from "../../../../../../src/modules/session/model/list/sessionRecords.js";
import {
  availableDetailDocument,
  availableSummaryEntry,
} from "../../../../helpers/sessionDetailFixture.js";

const helpers = {
  createConnectorPanelState: () => ({ selectedConnectorIds: [], connectors: [] }),
};

function mappedSummary({ aggregateVersion, updatedAt }) {
  return mapSummaryEntryToSession(
    availableSummaryEntry({
      sessionId: "s-refresh",
      title: "refresh",
      aggregateVersion,
      messageCount: 0,
      updatedAt,
    }),
    helpers,
  );
}

describe("sessionRecords aggregate version reconciliation", () => {
  it("rejects a loaded remote session without its document collection", () => {
    const session = {
      sessionId: "s-invalid",
      isLocal: false,
      loaded: true,
      aggregateVersion: 1,
      knownGeneration: null,
    };
    for (const sessionDocs of [undefined, null, {}]) {
      expect(() => hasCurrentSessionDetail({ ...session, sessionDocs })).toThrow(
        /requires sessionDocs/,
      );
    }
    expect(hasCurrentSessionDetail({ ...session, sessionDocs: [] })).toBe(false);
  });

  it("keeps the applied document version independent of a newer list version", () => {
    const existing = mappedSummary({ aggregateVersion: 2, updatedAt: "2026-07-15T10:01:00.000Z" });
    existing.loaded = true;
    existing.sessionDocs = availableDetailDocument({
      sessionId: "s-refresh",
      title: "refresh",
      aggregateVersion: 2,
      messages: [],
      turnTimings: [],
    }).sessions;
    expect(hasCurrentSessionDetail(existing)).toBe(true);
    reconcileSessionObject(
      mappedSummary({ aggregateVersion: 5, updatedAt: "2026-07-15T10:02:00.000Z" }),
      existing,
    );
    expect(existing.aggregateVersion).toBe(5);
    expect(existing.sessionDocs[0].aggregateVersion).toBe(2);
    expect(hasCurrentSessionDetail(existing)).toBe(false);
    expect(() => requireLoadedSessionDetail(existing)).toThrow(/current remote session detail/);
  });
  it("requires a remote detail read after a local session appears in the server list", () => {
    const existing = createLocalSessionItem({ id: "s-refresh", title: "local", ...helpers });
    const messages = [{ role: "assistant", content: "streaming response" }];
    existing.messages = messages;
    const summary = mappedSummary({ aggregateVersion: 1, updatedAt: "2026-07-15T10:01:00.000Z" });
    summary.messageCount = 2;

    const reconciled = reconcileSessionObject(summary, existing);

    expect(reconciled).toBe(existing);
    expect(reconciled.isLocal).toBe(false);
    expect(reconciled.loaded).toBe(false);
    expect(isLoadedRemoteSession(reconciled)).toBe(false);
    expect(reconciled.messages).toBe(messages);
    expect(reconciled.sessionDocs).toEqual([]);
    expect(reconciled.messageCount).toBe(2);
  });

  it("preserves loaded remote messages and their count across list refreshes", () => {
    const existing = mappedSummary({ aggregateVersion: 2, updatedAt: "2026-07-15T10:01:00.000Z" });
    existing.loaded = true;
    existing.messageCount = 3;
    const messages = [{ role: "assistant", content: "streaming response" }];
    existing.messages = messages;
    const summary = mappedSummary({ aggregateVersion: 1, updatedAt: "2026-07-15T10:00:30.000Z" });

    reconcileSessionObject(summary, existing);

    expect(isLoadedRemoteSession(existing)).toBe(true);
    expect(existing.messages).toBe(messages);
    expect(existing.messageCount).toBe(3);
  });

  it("does not let an earlier list snapshot roll back a realtime aggregate version", () => {
    const existing = mappedSummary({ aggregateVersion: 2, updatedAt: "2026-07-15T10:01:00.000Z" });
    const earlier = mappedSummary({ aggregateVersion: 1, updatedAt: "2026-07-15T10:00:30.000Z" });

    const reconciled = reconcileSessionObject(earlier, existing);

    expect(reconciled).toBe(existing);
    expect(reconciled.aggregateVersion).toBe(2);
  });

  it("advances the aggregate version from a newer list snapshot", () => {
    const existing = mappedSummary({ aggregateVersion: 1, updatedAt: "2026-07-15T10:01:00.000Z" });
    const newer = mappedSummary({ aggregateVersion: 2, updatedAt: "2026-07-15T10:01:00.000Z" });

    reconcileSessionObject(newer, existing);

    expect(existing.aggregateVersion).toBe(2);
  });

  it("does not carry turn lifecycle snapshots through list mapping", () => {
    const mapped = mappedSummary({ aggregateVersion: 1, updatedAt: "2026-07-15T10:01:00.000Z" });
    expect(mapped).not.toHaveProperty("turnLifecycleSnapshot");
    expect(mapped).not.toHaveProperty("lastMessage");
  });
});
