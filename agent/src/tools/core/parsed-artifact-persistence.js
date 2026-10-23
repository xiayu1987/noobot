/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireCommittedAuthorityEvent } from "@noobot/event-protocol/outbox";
import { filePath as path } from "@noobot/path-resolver";
import {
  ATTACHMENT_EVENT_TYPE,
  ATTACHMENT_LIFECYCLE,
  ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN,
  ATTACHMENT_LIFECYCLE_WIRE_EVENT,
  attachmentLifecycleSequenceScopeId,
  ATTACHMENT_RELATION_TYPE,
  ATTACHMENT_SOURCE,
  createAttachmentEventId,
  createAttachmentLifecycleEvent,
  findAttachmentRelation,
  projectAttachmentIdentity,
  formatAttachmentIdentityRef,
} from "@noobot/attachment-protocol";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import {
  getTransferAttachments,
  materializeTextForToolResult,
} from "../../transfer-adapter/index.js";
import { TRANSFER_SOURCE, TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import { MIME_TYPE } from "@noobot/attachment-protocol/mime";
import { updateRuntimeUserMessageAttachment } from "../../artifacts/index.js";
import { AGENT_RUN_EVENT, emitEvent } from "../../events/index.js";
import { queueUserMetaBackwrite } from "../../context/assembly/message-builder/user-meta-backwrite.js";
import { ARTIFACT_GENERATION_SOURCE, TOOL_NAME } from "../constants/index.js";
import { text, isFunction } from "@noobot/shared/value";

function sanitizeArtifactBaseName(input = "", fallback = "multimodal-parse") {
  const normalized = text(input);
  return normalized ? normalized.replace(/[^\w.-]+/g, "_") : fallback;
}

export async function persistParsedTextAttachment({
  runtime = {},
  inputFile = "",
  text: sourceText = "",
  mode = "",
  identity = null,
} = {}) {
  const inputBaseName = sanitizeArtifactBaseName(
    path.basename(text(inputFile), path.extname(text(inputFile))),
  );
  const modeSuffix = sanitizeArtifactBaseName(mode || "result", "result");
  const materialized = await materializeTextForToolResult({
    runtime,
    text: sourceText,
    name: `${inputBaseName}.multimodal-parse.${modeSuffix}.md`,
    mimeType: MIME_TYPE.TEXT_MARKDOWN,
    attachmentSource: ATTACHMENT_SOURCE.MODEL,
    generationSource: ARTIFACT_GENERATION_SOURCE.MULTIMODAL_PARSE_TOOL,
    source: TRANSFER_SOURCE.TOOL,
    reason: TRANSFER_REASON.MULTIMODAL_PARSE_ARTIFACT,
    alwaysPersist: true,
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

async function commitParsedLifecycleEvent(runtime, identity, relation) {
  const system = runtime.systemRuntime;
  const event = createAttachmentLifecycleEvent({
    eventType: ATTACHMENT_EVENT_TYPE.PARSED,
    eventVersion: 1,
    attachmentEventId: createAttachmentEventId(),
    identity,
    status: ATTACHMENT_LIFECYCLE.PARSED,
    occurredAt: new Date().toISOString(),
    turnScopeId: text(system.turnScopeId) || undefined,
    runId: text(system.runId) || undefined,
    relation,
  });
  if (!isFunction(runtime.sessionManager?.commitAuthorityEvent)) {
    throw new Error("attachment authority event commit port is unavailable");
  }
  const persistenceScope = system.persistenceScope;
  const committed = await runtime.sessionManager.commitAuthorityEvent({
    userId: text(system.userId),
    sessionId: text(system.sessionId),
    family: EVENT_FAMILY.ATTACHMENT_LIFECYCLE,
    identity: {
      eventType: ATTACHMENT_LIFECYCLE_WIRE_EVENT,
      turnScopeId: event.turnScopeId,
    },
    causality: { correlationId: event.runId },
    ordering: {
      domain: ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN,
      scopeId: attachmentLifecycleSequenceScopeId(event.identity),
    },
    producer: { type: "tool", id: TOOL_NAME.MULTIMODAL_PARSE },
    payload: event,
    persistenceScope,
  });
  const committedEnvelope = requireCommittedAuthorityEvent(committed);
  await emitEvent(runtime.eventListener, AGENT_RUN_EVENT.AUTHORITY_EVENT_COMMITTED, {
    envelope: committedEnvelope,
    persistenceScope,
  });
}

function queueParsedResultBackwrite(runtime, sourceIdentity, relation) {
  const sourceAttachmentRef = formatAttachmentIdentityRef(sourceIdentity);
  queueUserMetaBackwrite(runtime, {
    attachmentRef: sourceAttachmentRef,
    result: {
      sourceAttachmentRef,
      parsedAttachmentRef: formatAttachmentIdentityRef(relation.targetIdentity),
      name: relation.name,
      mimeType: relation.mimeType,
      ...(relation.size === undefined ? {} : { size: relation.size }),
    },
  });
}

export async function backwriteParsedAttachment({
  runtime,
  sourceAttachmentMeta,
  parsedAttachment,
}) {
  const sourceIdentity = projectAttachmentIdentity(sourceAttachmentMeta);
  const { identity, name, mimeType, size } = parsedAttachment;
  const updated = await runtime.attachmentService.linkParsedResultToAttachment({
    userId: text(runtime.systemRuntime.userId),
    sourceIdentity,
    targetDescriptor: { identity, name, mimeType, ...(size === undefined ? {} : { size }) },
    producerId: TOOL_NAME.MULTIMODAL_PARSE,
  });
  updateRuntimeUserMessageAttachment(runtime, sourceIdentity.attachmentId, updated);
  const updatedIdentity = projectAttachmentIdentity(updated);
  const relation = findAttachmentRelation(updated.relations, {
    relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
    sourceIdentity: updatedIdentity,
  });
  await commitParsedLifecycleEvent(runtime, updatedIdentity, relation);
  queueParsedResultBackwrite(runtime, sourceIdentity, relation);
  return updated;
}
