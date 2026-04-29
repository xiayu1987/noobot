/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
let systemPromptCachePromise = null;

export {
  resolveRuntimeBasePath,
  buildStaticInfo,
  buildDynamicInfo,
} from "./environment-provider.js";
export { resolveWorkspaceDirectories } from "./workspace-provider.js";
export { resolveConnectorStatusSection } from "./connector-status-provider.js";
export { resolveServices } from "./service-provider.js";
export { resolveAvailableMcpServers } from "./mcp-provider.js";
export { resolveModelSection, resolveAllEnabledProviders } from "./model-provider.js";

export async function loadSystemPrompt() {
  if (!systemPromptCachePromise) {
    systemPromptCachePromise = readFile("./system-core/system-prompt/base.md", "utf8")
      .catch((error) => {
        systemPromptCachePromise = null;
        throw error;
      });
  }
  return systemPromptCachePromise;
}

export async function resolveSessionTreeWithRootSessionId({
  runtimeBasePath = "",
  sessionManager = null,
  userId = "",
  sessionId = "",
  now = new Date().toISOString(),
} = {}) {
  if (!runtimeBasePath || !sessionManager?.getSessionTree) {
    return {
      sessionTree: { roots: [], nodes: {}, updatedAt: now },
      rootSessionId: String(sessionId || "").trim(),
    };
  }
  const sessionTree = await sessionManager.getSessionTree({ userId });
  const rootSessionId =
    sessionManager?.getRootSessionId && userId && sessionId
      ? await sessionManager.getRootSessionId({
          userId,
          sessionId,
          sessionTree,
        })
      : sessionId;
  return {
    sessionTree,
    rootSessionId: String(rootSessionId || sessionId || "").trim(),
  };
}

export async function resolveAttachments({
  attachmentService = null,
  runtimeBasePath = "",
  effectiveConfig = {},
  attachmentMetas = [],
  userId = "",
  sessionId = "",
} = {}) {
  if (!attachmentService || !runtimeBasePath) return [];
  const attachmentPolicy =
    effectiveConfig?.attachments && typeof effectiveConfig.attachments === "object"
      ? effectiveConfig.attachments
      : {};
  const hasIngestedRecords = (attachmentMetas || []).some(
    (attachmentItem) =>
      String(attachmentItem?.attachmentId || "").trim() &&
      String(attachmentItem?.path || "").trim(),
  );
  if (hasIngestedRecords) {
    return (attachmentMetas || []).map((attachmentItem) => ({
      attachmentId: String(attachmentItem?.attachmentId || ""),
      sessionId: String(attachmentItem?.sessionId || sessionId || ""),
      attachmentSource: String(attachmentItem?.attachmentSource || "user").trim(),
      name: String(attachmentItem?.name || ""),
      mimeType: String(attachmentItem?.mimeType || "application/octet-stream"),
      size: Number(attachmentItem?.size || 0),
      path: String(attachmentItem?.path || ""),
      relativePath: String(attachmentItem?.relativePath || ""),
    }));
  }
  return attachmentService.ingest({
    userId,
    sessionId: sessionId || "",
    attachmentSource: "user",
    attachments: attachmentMetas,
    attachmentPolicy,
  });
}

export async function resolveSkills({
  skillService = null,
  runtimeBasePath = "",
  userId = "",
} = {}) {
  if (!skillService || !runtimeBasePath) return [];
  return skillService.listSkills({ userId });
}

export async function resolveLongMemory({
  memoryService = null,
  runtimeBasePath = "",
  userId = "",
} = {}) {
  if (!memoryService || !runtimeBasePath) return [];
  return memoryService.readLongMemory({ userId });
}

export function toConversationMessages(sessionRecords = []) {
  return (sessionRecords || []).map((item) => ({
    role: item.role || "user",
    content: item.content || "",
    type: item.type || "",
    tool_calls: Array.isArray(item.tool_calls) ? item.tool_calls : [],
    tool_call_id: item.tool_call_id || "",
    attachmentMetas: Array.isArray(item.attachmentMetas)
      ? item.attachmentMetas
      : Array.isArray(item.attachments)
        ? item.attachments
        : [],
  }));
}
