/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export function assertSessionIdentity(session, expected) {
  expect(session.sessionId).toBe(expected.sessionId);
  if (expected.userId) expect(session.userId).toBe(expected.userId);
}

export function assertMonotonicAggregateVersions(records = []) {
  for (let index = 1; index < records.length; index += 1) {
    expect(records[index].aggregateVersion).toBeGreaterThan(records[index - 1].aggregateVersion);
  }
}

export function assertNoLegacySessionProtocolKeys(value) {
  const forbidden = new Set([
    "backendSessionId",
    "expectedVersion",
    "expectedSessionVersion",
    "sessionVersion",
    "snapshotVersion",
    "committedVersion",
    "idempotencyKey",
  ]);
  const violations = [];
  const visit = (item, location = "$") => {
    if (Array.isArray(item)) {
      item.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [key, entry] of Object.entries(item)) {
      if (forbidden.has(key)) violations.push(`${location}.${key}`);
      visit(entry, `${location}.${key}`);
    }
  };
  visit(value);
  expect(violations).toEqual([]);
}

export function assertResendReplacementIdentityChain(commands = [], session = {}) {
  const resendCommands = commands.filter((command = {}) => command.commandType === "turn.resend");
  const turnOrder = Array.isArray(session?.turnOrder) ? session.turnOrder : [];
  const replacements = Object.values(session?.turnLifecycle?.replacedTurns || {});
  for (const command of resendCommands) {
    const dialogProcessId = String(command?.identity?.dialogProcessId || "").trim();
    const turnScopeId = String(command?.identity?.turnScopeId || "").trim();
    expect(dialogProcessId).toBeTruthy();
    expect(turnScopeId).toBeTruthy();
    const materializedTurn = turnOrder.find((turn = {}) => turn.turnScopeId === turnScopeId);
    const replacementTombstones = replacements.filter((replacement = {}) => (
      replacement.replacementTurnScopeId === turnScopeId
    ));
    expect(Boolean(materializedTurn) || replacementTombstones.length > 0).toBe(true);
    if (materializedTurn) expect(materializedTurn.dialogProcessId).toBe(dialogProcessId);
    for (const replacement of replacementTombstones) {
      expect(replacement.replacementDialogProcessId).toBe(dialogProcessId);
    }
  }
}
