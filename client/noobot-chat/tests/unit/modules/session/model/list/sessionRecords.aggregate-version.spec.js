/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  mapSummaryEntryToSession,
  reconcileSessionObject,
} from "../../../../../../src/modules/session/model/list/sessionRecords.js";
import { availableSummaryEntry } from "../../../../helpers/sessionDetailFixture.js";

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
