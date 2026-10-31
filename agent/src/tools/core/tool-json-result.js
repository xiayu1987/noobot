/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text } from "@noobot/shared/value";
import { Buffer } from "node:buffer";
import {
  assertToolResultObject,
  decodeToolResultText,
  encodeToolResultObject,
} from "@noobot/event-protocol/tool-result";
import { projectTransferEnvelopesForModel } from "@noobot/semantic-transfer-protocol";
import { projectAttachmentMetaForModel } from "../../artifacts/meta-ops.js";

function isCanonicalBase64(value = "") {
  const normalized = text(value);
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return false;
  return Buffer.from(normalized, "base64").toString("base64") === normalized;
}

const OUTPUT_ARTIFACT_FIELDS = new Set(["type", "name", "mimeType", "content", "contentBase64"]);

export function parseToolOutputArtifacts(resultObject) {
  const source = assertToolResultObject(resultObject);
  if (source.outputArtifacts === undefined) return [];
  if (!Array.isArray(source.outputArtifacts)) throw new Error("invalid_tool_output_artifacts");
  return source.outputArtifacts.map((artifact, index) => {
    if (!isPlainObject(artifact)) throw new Error("invalid_tool_output_artifact");
    for (const key of Object.keys(artifact)) {
      if (!OUTPUT_ARTIFACT_FIELDS.has(key))
        throw new Error(`unknown_tool_output_artifact_field:${key}`);
    }
    const name = text(artifact.name);
    const type = text(artifact.type);
    const mimeType = text(artifact.mimeType);
    const hasContent = typeof artifact.content === "string";
    const hasContentBase64 = typeof artifact.contentBase64 === "string";
    const content = hasContent ? artifact.content : "";
    const contentBase64 = hasContentBase64 ? text(artifact.contentBase64) : "";
    if (!["text", "attachment_url", "attachment_bytes"].includes(type))
      throw new Error(`invalid_tool_output_artifact_type:${index}`);
    if (!name) throw new Error(`invalid_tool_output_artifact_name:${index}`);
    if (!mimeType) throw new Error(`invalid_tool_output_artifact_mime_type:${index}`);
    if (!hasContent && !hasContentBase64)
      throw new Error(`invalid_tool_output_artifact_content:${index}`);
    if (hasContent && hasContentBase64)
      throw new Error(`ambiguous_tool_output_artifact_content:${index}`);
    if (
      type === "attachment_bytes" &&
      (!hasContentBase64 || hasContent || !isCanonicalBase64(contentBase64))
    )
      throw new Error(`invalid_tool_output_artifact_bytes:${index}`);
    if (type !== "attachment_bytes" && !hasContent)
      throw new Error(`invalid_tool_output_artifact_text:${index}`);
    return {
      type,
      name,
      mimeType,
      ...(hasContentBase64 ? { contentBase64 } : { content }),
    };
  });
}

export function stripToolOutputArtifacts(resultObject) {
  const { outputArtifacts: _outputArtifacts, ...publicResult } =
    assertToolResultObject(resultObject);
  return publicResult;
}

function projectCanonicalAttachmentFields(value) {
  if (!isPlainObject(value)) return null;
  const { attachmentId, sessionId, attachmentSource } = value;
  const fields = [attachmentId, sessionId, attachmentSource];
  const hasAttachmentIdentityField = attachmentId !== undefined || attachmentSource !== undefined;
  if (!hasAttachmentIdentityField) return null;
  if (fields.some((field) => !text(field))) {
    throw new Error("incomplete_attachment_identity");
  }
  if (Object.hasOwn(value, "attachmentRef")) {
    throw new Error("mixed_attachment_identity_representations");
  }
  return projectAttachmentMetaForModel(value);
}

export function projectToolResultForModel(toolResultText) {
  const source = decodeToolResultText(toolResultText);
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!isPlainObject(value)) return value;
    const attachmentProjection = projectCanonicalAttachmentFields(value);
    if (attachmentProjection) return visit(attachmentProjection);
    if (Object.hasOwn(value, "transferEnvelopes") && Object.hasOwn(value, "attachmentRefs")) {
      throw new Error("mixed_attachment_transfer_representations");
    }
    if (Object.hasOwn(value, "identity") && Object.hasOwn(value, "attachmentRef")) {
      throw new Error("mixed_attachment_identity_representations");
    }
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (
        key === "resources" ||
        key === "input_resources" ||
        key === "outputResources" ||
        key === "resourceId"
      ) {
        continue;
      }
      if (key === "transferEnvelopes") {
        out.transfers = projectTransferEnvelopesForModel(child);
        continue;
      }
      if (key === "identity") {
        const projectedIdentity = projectCanonicalAttachmentFields(child);
        if (projectedIdentity) {
          out.attachmentRef = projectedIdentity.attachmentRef;
          continue;
        }
      }
      out[key] = visit(child);
    }
    return out;
  };
  return JSON.stringify(visit(source));
}

export function toToolJsonResult(toolName, payload) {
  const name = text(toolName);
  if (!name) throw new TypeError("tool result requires toolName");
  return encodeToolResultObject({ toolName: name, ...assertToolResultObject(payload) });
}
