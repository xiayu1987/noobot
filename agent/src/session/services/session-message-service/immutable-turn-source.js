/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export async function readImmutableTurnMutationSource(reader, event) {
  const metadata = await reader.readMetadata();
  const header = await reader.readLifecycleHead();
  const current = await reader.readTurnState(event.turnScopeId);
  const receipt = event.commandId ? await reader.readCommand(event.commandId) : null;
  const selected = new Map([[event.turnScopeId, current]]);
  const continuationOwner = current === null ? event : current;
  for (const scope of [
    header.activeTurnScopeId,
    continuationOwner.continuationSource?.turnScopeId,
    receipt?.turnScopeId,
  ]) {
    if (scope && !selected.has(scope)) selected.set(scope, await reader.readTurnState(scope));
  }
  const descriptor = current ?? (await reader.readTurnDescriptor(event.turnScopeId));
  const dialog = descriptor ? await reader.readDialog(descriptor.dialogProcessId) : null;

  const firstPage = await reader.readTurnPage({
    turnScopeId: event.turnScopeId,
    limit: QUANTITY_THRESHOLDS.immutableStorage.turnAcceptancePageSize,
  });
  const accepted = firstPage?.records[0]?.message;
  const timing = await reader.readTurnTiming(event.turnScopeId);
  return {
    ...metadata,
    messages: accepted?.role === "user" ? [accepted] : [],
    dialogOrder: dialog ? [dialog] : [],
    turnTimings: timing ? [timing] : [],
    sessionArtifactEvents: [],
    turnLifecycle: {
      ...header,
      turns: Object.fromEntries([...selected].filter(([, turn]) => turn !== null)),
      replacedTurns: {},
      commandReceipts: receipt ? [receipt] : [],
    },
  };
}
