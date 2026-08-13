/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseAttachmentIdentity } from "@noobot/attachment-protocol";
import { filePath as path } from "@noobot/path-resolver";
import { z } from "zod";
import { resolveCanonicalSourceAttachment } from "../../artifacts/index.js";
import { getBasePathFromAgentContext } from "../../context/agent-context-accessor.js";
import { assertAndResolveUserWorkspaceFilePath, projectResolvedFilePath } from "./check-tool-input.js";

export const attachmentIdentitySchema = z.object({
  attachmentId: z.string().min(1),
  sessionId: z.string().min(1),
  attachmentSource: z.string().min(1),
}).strict();

export function createFileInputSchema({ filePathDescription, attachmentIdentityDescription } = {}) {
  return z.object({
    source: z.union([
      z.string().min(1).describe(filePathDescription || "Logical file path."),
      attachmentIdentitySchema.describe(
        attachmentIdentityDescription || "Complete attachment identity.",
      ),
    ]).describe("Logical file path or complete attachment identity."),
  }).strict();
}

export async function resolveFileInput({
  source,
  agentContext,
  fieldName = "filePath",
  capability,
} = {}) {
  const attachmentIdentity = source && typeof source === "object" && !Array.isArray(source)
    ? parseAttachmentIdentity(source)
    : null;
  let sourceAttachmentMeta = null;
  let authorizationInput = attachmentIdentity ? "" : String(source || "").trim();
  if (!attachmentIdentity && !authorizationInput) throw new TypeError(`${fieldName} source is required`);
  if (attachmentIdentity) {
    sourceAttachmentMeta = await resolveCanonicalSourceAttachment({ attachmentIdentity, agentContext });
    if (!sourceAttachmentMeta) throw new Error("attachment not found for the supplied identity");
    const executionPath = String(sourceAttachmentMeta.absolutePath || sourceAttachmentMeta.path || "").trim();
    if (!executionPath) throw new Error("attachment has no execution path");
    authorizationInput = path.relative(getBasePathFromAgentContext(agentContext), executionPath);
  }

  const executionPath = await assertAndResolveUserWorkspaceFilePath({
    filePath: authorizationInput,
    agentContext,
    fieldName,
    mustExist: true,
    capability,
  });
  return {
    executionPath,
    displayInput: sourceAttachmentMeta
      ? attachmentIdentity
      : projectResolvedFilePath({ resolvedPath: executionPath, agentContext }),
    sourceAttachmentMeta,
  };
}

export function isUserAttachment(attachmentMeta = null) {
  return String(attachmentMeta?.attachmentSource || "").trim() === "user";
}
