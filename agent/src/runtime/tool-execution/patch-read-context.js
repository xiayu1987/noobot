/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveContextMessageRole,
  resolveContextMessageContent,
  resolveContextToolCalls,
  resolveContextToolCallDeclarationId,
  resolveContextToolCallName,
  resolveContextToolResultCallId,
} from "@noobot/context-protocol/message/codec";
import { PATCH_READ_VERSIONS, createPatchReadVersions } from "@noobot/file-mutation-protocol";
import { TOOL_NAME } from "../../tools/constants/index.js";

function registerToolDeclarations(batches, message, batch) {
  for (const call of resolveContextToolCalls(message)) {
    const id = resolveContextToolCallDeclarationId(call);
    if (!id || batches.has(id)) throw new TypeError("read history requires unique tool call IDs");
    batches.set(id, { batch, name: resolveContextToolCallName(call) });
  }
}

export function capturePatchReadVersions(messages) {
  const batches = new Map();
  const observations = [];
  for (const [batch, message] of messages.entries()) {
    const role = resolveContextMessageRole(message);
    if (role === "assistant") {
      registerToolDeclarations(batches, message, batch);
    }
    if (role !== "tool") continue;
    const callId = resolveContextToolResultCallId(message);
    const declaration = batches.get(callId);
    batches.delete(callId);
    if (declaration?.name !== TOOL_NAME.READ_FILE) continue;
    const content = resolveContextMessageContent(message);
    if (typeof content !== "string" || !content.includes('"baseSha256"')) continue;
    const result = JSON.parse(content);
    if (result.toolName !== TOOL_NAME.READ_FILE || result.ok !== true || result.overflowed)
      continue;
    observations.push({
      locator: result.path,
      sha256: result.baseSha256,
      batch: declaration.batch,
    });
  }
  return createPatchReadVersions(observations);
}

export function bindPatchReadVersions(output, readVersions) {
  return {
    ...output,
    toolCalls: output.toolCalls.map((call) => ({ ...call, [PATCH_READ_VERSIONS]: readVersions })),
  };
}
