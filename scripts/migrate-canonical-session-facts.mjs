#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { readSessionArtifact, writeSessionArtifact } from "../agent/src/session/session-artifact-store.js";
import { projectWrittenFileFromToolResult } from "../agent/src/artifacts/runtime/tool-result-artifact-projection.js";

function text(value = "") {
  return String(value || "").trim();
}

function parseArgs(argv = []) {
  const sessionDirs = [];
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--write") write = true;
    if (item === "--session-dir" && argv[index + 1]) sessionDirs.push(path.resolve(argv[++index]));
  }
  if (!sessionDirs.length) throw new Error("at least one --session-dir is required");
  return { sessionDirs, write };
}

function migrateMessages(session = {}) {
  const lifecycleTurns = session?.turnLifecycle?.turns && typeof session.turnLifecycle.turns === "object"
    ? session.turnLifecycle.turns
    : {};
  const toolResultsByCallId = new Map(
    (Array.isArray(session?.messages) ? session.messages : [])
      .filter((message = {}) => text(message?.role) === "tool" && text(message?.tool_call_id))
      .map((message = {}) => [text(message.tool_call_id), message]),
  );
  let presentationIdentityCount = 0;
  let toolArtifactCount = 0;
  const messages = (Array.isArray(session?.messages) ? session.messages : []).map((message = {}) => {
    let next = message;
    const turnScopeId = text(message?.turnScopeId);
    const lifecyclePresentationMessageId = text(lifecycleTurns?.[turnScopeId]?.presentationMessageId);
    if (text(message?.role) === "assistant" && !text(message?.presentationMessageId) && lifecyclePresentationMessageId) {
      next = { ...next, presentationMessageId: lifecyclePresentationMessageId };
      presentationIdentityCount += 1;
    }
    if (!Array.isArray(message?.toolTimeline)) return next;
    const toolTimeline = message.toolTimeline.map((entry = {}) => {
      const resultEvent = entry?.resultEvent && typeof entry.resultEvent === "object"
        ? entry.resultEvent
        : null;
      if (!resultEvent || Array.isArray(resultEvent?.writtenFiles) && resultEvent.writtenFiles.length) return entry;
      const toolCallId = text(entry?.toolCallId);
      const toolResult = toolResultsByCallId.get(toolCallId);
      const writtenFile = projectWrittenFileFromToolResult(entry?.tool, toolResult?.content || "");
      const attachments = Array.isArray(toolResult?.attachments) ? toolResult.attachments : [];
      if (!writtenFile && !attachments.length) return entry;
      const artifactPatch = {
        ...(writtenFile ? { writtenFiles: [writtenFile] } : {}),
        ...(attachments.length ? { attachments } : {}),
      };
      toolArtifactCount += 1;
      return {
        ...entry,
        resultEvent: {
          ...resultEvent,
          ...artifactPatch,
          ...(resultEvent?.log && typeof resultEvent.log === "object"
            ? { log: { ...resultEvent.log, ...artifactPatch } }
            : {}),
        },
      };
    });
    return { ...next, toolTimeline };
  });
  return { messages, presentationIdentityCount, toolArtifactCount };
}

const { sessionDirs, write } = parseArgs(process.argv.slice(2));
for (const sessionDir of sessionDirs) {
  const session = await readSessionArtifact({ sessionDir, fallback: null });
  if (!session) throw new Error(`session artifact not found: ${sessionDir}`);
  const migrated = migrateMessages(session);
  const changed = migrated.presentationIdentityCount + migrated.toolArtifactCount > 0;
  if (write && changed) {
    await writeSessionArtifact({ sessionDir, sessionPayload: { ...session, messages: migrated.messages } });
  }
  process.stdout.write(`${JSON.stringify({
    sessionDir,
    sessionId: text(session?.sessionId),
    write,
    changed,
    presentationIdentityCount: migrated.presentationIdentityCount,
    toolArtifactCount: migrated.toolArtifactCount,
  })}\n`);
}
