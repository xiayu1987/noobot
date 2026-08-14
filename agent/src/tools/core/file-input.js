/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentIdentity } from "@noobot/attachment-protocol";
import { filePath as path, isResourceRef } from "@noobot/path-resolver";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { resolveCanonicalSourceAttachment } from "../../artifacts/index.js";
import { getBasePathFromAgentContext } from "../../context/agent-context-accessor.js";
import { assertAndResolveUserWorkspaceFilePath } from "./check-tool-input.js";
import {
  getRegisteredResource,
  registerResolvedResource,
  registerResource,
} from "./resource-broker.js";

export const attachmentIdentitySchema = z
  .object({
    attachmentId: z.string().min(1),
    sessionId: z.string().min(1),
    attachmentSource: z.string().min(1),
  })
  .strict();

export const resourceRefSchema = z
  .object({
    version: z.number().int().optional(),
    resourceId: z.string().min(1),
    kind: z.literal("file"),
    owner: z.string().min(1),
    source: z.enum(["workspace", "attachment", "host"]),
    logical: z
      .object({ view: z.enum(["workspace", "attachment", "host"]), path: z.string().min(1) })
      .strict(),
    attachment: attachmentIdentitySchema.nullable(),
    size: z.number().nullable(),
    mimeType: z.string().min(1),
    capabilities: z
      .object({ read: z.boolean(), write: z.boolean(), scriptInput: z.boolean() })
      .strict(),
  })
  .strict();

export function createFileInputSchema({ filePathDescription, attachmentIdentityDescription } = {}) {
  return z
    .object({
      source: z
        .union([
          z
            .string()
            .min(1)
            .describe(filePathDescription || "Logical file path."),
          attachmentIdentitySchema.describe(
            attachmentIdentityDescription || "Complete attachment identity.",
          ),
        ])
        .describe("Logical file path or complete attachment identity."),
    })
    .strict();
}

export async function resolveFileInput({
  source,
  agentContext,
  fieldName = "filePath",
  capability,
  mustExist = true,
} = {}) {
  const resourceInput = isResourceRef(source) ? source : null;
  if (resourceInput) {
    if (capability === "file.write" && resourceInput.capabilities?.write !== true)
      throw new Error("resource is not writable");
    if (
      ["script.input", "native.input", "multimodal.input"].includes(capability) &&
      resourceInput.capabilities?.scriptInput !== true
    )
      throw new Error("resource cannot be used as script input");
  }
  const registered = resourceInput
    ? getRegisteredResource({ agentContext, resourceId: resourceInput.resourceId })
    : null;
  if (registered) {
    const publicInput =
      registered.ref.source === "attachment"
        ? registered.ref.attachment
        : registered.ref.logical.path;
    return {
      executionPath: registered.executionPath,
      displayInput: publicInput,
      resourceRef: registered.ref,
      sourceAttachmentMeta:
        registered.ref.source === "attachment" ? registered.ref.attachment : null,
    };
  }
  const attachmentIdentity =
    source && typeof source === "object" && !Array.isArray(source)
      ? resourceInput
        ? parseAttachmentIdentity(resourceInput.attachment)
        : parseAttachmentIdentity(source)
      : null;
  let sourceAttachmentMeta = null;
  let authorizationInput = resourceInput
    ? ["workspace", "host"].includes(resourceInput.source)
      ? resourceInput.logical.path
      : ""
    : attachmentIdentity
      ? ""
      : String(source || "").trim();
  if (!attachmentIdentity && !authorizationInput)
    throw new TypeError(`${fieldName} source is required`);
  if (attachmentIdentity) {
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

  const executionPath = await assertAndResolveUserWorkspaceFilePath({
    filePath: authorizationInput,
    agentContext,
    fieldName,
    mustExist,
    capability,
  });
  if (!mustExist && !(await stat(executionPath).catch(() => null))) {
    return {
      executionPath,
      displayInput: resourceInput
        ? resourceInput.source === "attachment"
          ? resourceInput.attachment
          : resourceInput.logical.path
        : attachmentIdentity || String(source || "").trim(),
      resourceRef: resourceInput || null,
      sourceAttachmentMeta,
    };
  }
  const resourceRef = resourceInput
    ? registerResolvedResource({ agentContext, resourceRef: resourceInput, executionPath })
    : await registerResource({
        agentContext,
        executionPath,
        source: sourceAttachmentMeta ? "attachment" : "workspace",
        attachment: sourceAttachmentMeta ? attachmentIdentity : null,
        logicalPath: sourceAttachmentMeta?.name || path.basename(executionPath),
        capabilities: { read: true, write: false, scriptInput: true },
      });
  return {
    executionPath,
    displayInput: sourceAttachmentMeta
      ? attachmentIdentity
      : String(resourceRef.logical?.path || authorizationInput || "").trim(),
    resourceRef,
    sourceAttachmentMeta,
  };
}

export function isUserAttachment(attachmentMeta = null) {
  return String(attachmentMeta?.attachmentSource || "").trim() === "user";
}
