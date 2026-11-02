/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createCheckpointIdentitySource,
  hydrateCheckpointReceipts,
  storeCheckpointReceipts,
} from "@noobot/session-protocol/summary-checkpoint-storage";
import { readVerifiedCheckpointIdentity } from "./turn-materializer.js";

async function readCheckpointIdentitySource({ storageService, sessionDir, session }) {
  const source = createCheckpointIdentitySource(session);
  for (const turn of session.turnOrder) {
    let previousCheckpointHash = "";
    for (const index of turn.summarySnapshots) {
      const checkpoint = await readVerifiedCheckpointIdentity({
        storageService,
        sessionDir,
        index,
        previousCheckpointHash,
      });
      source.collect(turn, index, checkpoint);
      previousCheckpointHash = index.contentHash;
    }
  }
  return source.resolve;
}

export async function readCheckpointReceiptProjection(options) {
  return hydrateCheckpointReceipts(options.session, await readCheckpointIdentitySource(options));
}

export async function buildStoredCheckpointReceipts(options) {
  return storeCheckpointReceipts(options.session, await readCheckpointIdentitySource(options));
}
