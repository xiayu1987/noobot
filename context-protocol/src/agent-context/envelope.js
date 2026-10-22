/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  AGENT_CONTEXT_KIND,
  AGENT_CONTEXT_PROTOCOL_VERSION,
  MODEL_CONTEXT_PROTOCOL_VERSION,
} from "./schema.js";
import { assertValidAgentContextEnvelope } from "./validation.js";
import { normalizeUserMetaBackwrites } from "../policy/user-meta-backwrite.js";

export function createAgentContextEnvelope({
  identity,
  environment,
  execution,
  messageBlocks,
  userMetaBackwrites,
}) {
  return assertValidAgentContextEnvelope({
    kind: AGENT_CONTEXT_KIND,
    protocolVersion: AGENT_CONTEXT_PROTOCOL_VERSION,
    identity,
    environment,
    execution,
    modelContext: {
      protocolVersion: MODEL_CONTEXT_PROTOCOL_VERSION,
      messageBlocks,
      userMetaBackwrites: normalizeUserMetaBackwrites(userMetaBackwrites),
    },
  });
}
