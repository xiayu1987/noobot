/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildChatPayload } from "./payload.js";

export function createTurnPayloadBuilder({ preferences, request, turn }) {
  return ({ expectedAggregateVersion }) =>
    buildChatPayload({
      ...preferences,
      request,
      activeSession: turn.activeSession,
      attachments: turn.attachments,
      requestedTextStreaming: turn.requestedTextStreaming,
      expectedAggregateVersion,
    });
}
