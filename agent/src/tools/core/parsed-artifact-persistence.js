/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { randomUUID } from "node:crypto";
import {
  ATTACHMENT_EVENT_TYPE,
  ATTACHMENT_LIFECYCLE,
  ATTACHMENT_RELATION_TYPE,
  createAttachmentLifecycleEvent,
  findAttachmentRelation,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";
import {
  getTransferAttachments,
  materializeTextForToolResult,
  TRANSFER_SOURCE,
} from "../../transfer-adapter/index.js";
import { MIME_TYPE } from "../../shared/constants/index.js";
import { updateRuntimeUserMessageAttachment } from "../../artifacts/index.js";
import { emitEvent } from "../../events/index.js";
import {
  ARTIFACT_GENERATION_SOURCE,
  TOOL_ATTACHMENT_SOURCE,
  TOOL_NAME,
} from "../constants/index.js";

function sanitizeArtifactBaseName(input = "", fallback = "multimodal-parse") {
  const normalized = String(input || "").trim();
  return normalized ? normalized.replace(/[^\w.-]+/g, "_") : fallback;
}

export async function persistParsedTextAttachment({
  runtime = {},
  agentContext = null,
  inputFile = "",
  text = "",
  mode = "",
  identity = null,
} = {}) {
  const inputBaseName = sanitizeArtifactBaseName(
    path.basename(String(inputFile || "").trim(), path.extname(String(inputFile || "").trim())),
  );
  const modeSuffix = sanitizeArtifactBaseName(mode || "result", "result");
  const materialized = await materializeTextForToolResult({
    runtime,
    agentContext,
    text,
    name: `${inputBaseName}.multimodal-parse.${modeSuffix}.md`,
    mimeType: MIME_TYPE.TEXT_MARKDOWN,
    attachmentSource: TOOL_ATTACHMENT_SOURCE.MODEL,
    generationSource: ARTIFACT_GENERATION_SOURCE.MULTIMODAL_PARSE_TOOL,
    source: TRANSFER_SOURCE.TOOL,
    reason: ARTIFACT_GENERATION_SOURCE.MULTIMODAL_PARSE_TOOL,
    alwaysPersist: true,
    producer: { type: "tool", name: TOOL_NAME.MULTIMODAL_PARSE },
    identity,
    meta: { mode },
  });
  return {
    attachments: getTransferAttachments(materialized.transferEnvelopes),
    transferEnvelopes: materialized.transferEnvelopes,
    resultFields: materialized.resultFields,
  };
}

export function normalizePersistedAttachments(persistedOutput) {
  return Array.isArray(persistedOutput?.attachments) ? persistedOutput.attachments : [];
}

export async function backwriteParsedAttachment({
  runtime,
  sourceAttachmentMeta,
  parsedAttachment,
}) {
  if (String(sourceAttachmentMeta?.attachmentSource || "").trim() !== "user") return null;
  const sourceIdentity = projectAttachmentIdentity(sourceAttachmentMeta);
  const targetAttachment = parsedAttachment?.identity
    ? { ...parsedAttachment, ...parsedAttachment.identity }
    : parsedAttachment;
  const attachmentService = runtime?.attachmentService || null;
  const userId = String(runtime?.userId || "").trim();
  if (!targetAttachment || !attachmentService || !userId) return null;
  const updated = await attachmentService.linkParsedResultToAttachment({
    userId,
    sourceIdentity,
    targetAttachment,
    producerId: TOOL_NAME.MULTIMODAL_PARSE,
  });
  updateRuntimeUserMessageAttachment(runtime, sourceIdentity.attachmentId, updated);
  const identity = projectAttachmentIdentity(updated);
  const relation = findAttachmentRelation(updated.relations, {
    relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
    sourceIdentity: identity,
  });
  const event = createAttachmentLifecycleEvent({
    eventType: ATTACHMENT_EVENT_TYPE.PARSED,
    eventVersion: 1,
    messageId: `attachment-event:${randomUUID()}`,
    identity,
    status: ATTACHMENT_LIFECYCLE.PARSED,
    occurredAt: new Date().toISOString(),
    turnScopeId: String(runtime?.systemRuntime?.turnScopeId || "").trim() || undefined,
    runId: String(runtime?.systemRuntime?.runId || "").trim() || undefined,
    relation,
  });
  emitEvent(runtime?.eventListener || null, "attachment_lifecycle", event);
  return updated;
}
