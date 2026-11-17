/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { requireTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";
import { openSessionArtifactReader } from "./session-artifact-session/immutable-session-reader.js";

export { buildThinkingDetailPayload } from "./session-thinking-detail-payload.js";

export async function readSessionThinkingDetail({ sessionDir, turnScopeId, dialogProcessId }) {
  const lookupKey = requireTurnLookupKey({ turnScopeId, dialogProcessId });
  await using reader = await openSessionArtifactReader({ sessionDir });
  return await reader.readThinkingDetail(lookupKey);
}
