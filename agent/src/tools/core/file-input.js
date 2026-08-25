/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ATTACHMENT_IDENTITY_REF_PREFIX,
  parseAttachmentIdentityRef,
} from "@noobot/attachment-protocol";
import { filePath as path, resolvePathRef } from "@noobot/path-resolver";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { resolveCanonicalSourceAttachment } from "../../artifacts/index.js";
import { getBasePathFromAgentContext } from "../../context/agent-context-accessor.js";
import { resolveAuthorizedUserWorkspaceFilePath } from "./check-tool-input.js";
import { registerResource } from "./resource-broker.js";

export function createFileSourceSchema({ filePathDescription, attachmentRefDescription } = {}) {
  return z
    .string()
    .min(1)
    .describe(
      [
        filePathDescription || "Logical file path.",
        attachmentRefDescription || "Canonical attachment reference.",
      ].join(" "),
    );
}

export function createFileInputSchema(options = {}) {
  return z.object({ source: createFileSourceSchema(options) }).strict();
}

export async function resolveFileInput({
  source,
  agentContext,
  fieldName = "filePath",
  capability,
  mustExist = true,
} = {}) {
  if (typeof source !== "string") throw new TypeError(`${fieldName} source must be a string`);
  const normalizedSource = source.trim();
  const attachmentIdentity = normalizedSource.startsWith(ATTACHMENT_IDENTITY_REF_PREFIX)
    ? parseAttachmentIdentityRef(normalizedSource)
    : null;
  let sourceAttachmentMeta = null;
  let authorizationInput = attachmentIdentity ? "" : normalizedSource;
  if (!attachmentIdentity && !authorizationInput)
    throw new TypeError(`${fieldName} source is required`);
  if (attachmentIdentity) {
    if (["file.write", "file.patch"].includes(capability)) {
      throw new Error("attachment resources are read-only");
    }
    sourceAttachmentMeta = await resolveCanonicalSourceAttachment({
      attachmentIdentity,
      agentContext,
    });
    if (!sourceAttachmentMeta) throw new Error("attachment not found for the supplied identity");
    const executionPath = String(
      sourceAttachmentMeta.absolutePath || sourceAttachmentMeta.path || "",
    ).trim();
    if (!executionPath) throw new Error("attachment has no execution path");
    authorizationInput = path.relative(getBasePathFromAgentContext(agentContext), executionPath);
  }

  const resolution = await resolveAuthorizedUserWorkspaceFilePath({
    filePath: authorizationInput,
    agentContext,
    fieldName,
    mustExist,
    capability,
  });
  const executionPath = resolution.executionPath;
  if (!mustExist && !(await stat(executionPath).catch(() => null))) {
    return {
      executionPath,
      displayInput: normalizedSource,
      resourceRef: null,
      pathRef: resolution.pathRef,
      sourceAttachmentMeta,
    };
  }
  const resourceRef = await registerResource({
    agentContext,
    executionPath,
    source: sourceAttachmentMeta ? "attachment" : "workspace",
    attachment: sourceAttachmentMeta ? attachmentIdentity : null,
    logicalPath: sourceAttachmentMeta?.name || path.basename(executionPath),
    logicalPathRef: sourceAttachmentMeta ? null : resolution.pathRef,
    capabilities: { read: true, write: false, scriptInput: true },
  });
  return {
    executionPath,
    displayInput: sourceAttachmentMeta
      ? normalizedSource
      : String(resourceRef.logical?.path || authorizationInput || "").trim(),
    resourceRef,
    pathRef: sourceAttachmentMeta
      ? resolvePathRef({ input: { view: "attachment", identity: attachmentIdentity } })
      : resourceRef.logical,
    sourceAttachmentMeta,
  };
}

export function isUserAttachment(attachmentMeta = null) {
  return String(attachmentMeta?.attachmentSource || "").trim() === "user";
}
