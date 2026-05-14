/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function toConversationMessages(sessionRecords = []) {
  return (sessionRecords || []).map((item) => ({
    role: item.role || "user",
    content: item.content || "",
    rawModelContent:
      typeof item?.rawModelContent === "string" ||
      Array.isArray(item?.rawModelContent)
        ? item.rawModelContent
        : null,
    type: item.type || "",
    tool_calls: Array.isArray(item.tool_calls) ? item.tool_calls : [],
    tool_call_id: item.tool_call_id || "",
    modelAdditionalKwargs:
      item?.modelAdditionalKwargs &&
      typeof item.modelAdditionalKwargs === "object" &&
      !Array.isArray(item.modelAdditionalKwargs)
        ? item.modelAdditionalKwargs
        : null,
    modelResponseMetadata:
      item?.modelResponseMetadata &&
      typeof item.modelResponseMetadata === "object" &&
      !Array.isArray(item.modelResponseMetadata)
        ? item.modelResponseMetadata
        : null,
    attachmentMetas: Array.isArray(item.attachmentMetas)
      ? item.attachmentMetas
      : Array.isArray(item.attachments)
        ? item.attachments
        : [],
  }));
}
