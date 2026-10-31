/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentIdentity } from "@noobot/attachment-protocol";
import { getRuntimeFromAgentContext } from "../context/agent-context-accessor.js";

export async function resolveCanonicalSourceAttachment({ attachmentIdentity, agentContext }) {
  const identity = parseAttachmentIdentity(attachmentIdentity);
  const runtime = getRuntimeFromAgentContext(agentContext);
  return runtime.attachmentService.getAttachmentById({
    userId: runtime.systemRuntime.userId,
    ...identity,
  });
}
