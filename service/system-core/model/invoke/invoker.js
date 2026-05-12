/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Model invocation with text and multimodal attachments.
 */
import { HumanMessage } from "@langchain/core/messages";
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "../../i18n/system-text.js";
import { normalizeProviderFormat } from "../../config/core/enums.js";
import { normalizeModelSpecWithDefaults } from "../spec/normalizer.js";
import { resolveModelSpecByName } from "../resolver/index.js";
import { createChatModelFromSpec } from "../factory/chat-model.js";
import { buildAttachmentContentBlock, normalizeModelOutputContent } from "../attachment/formatter.js";

/**
 * Invoke a model with text and optional attachments.
 * @param {object} params
 * @param {string} params.modelName
 * @param {string} params.text
 * @param {Array} params.attachments
 * @param {object} params.globalConfig
 * @param {object} params.userConfig
 * @param {boolean} params.streaming
 * @returns {Promise<{response: object, text: string, modelSpec: object}>}
 */
export async function invokeModelWithTextAndAttachments({
  modelName = "",
  text = "",
  attachments = [],
  globalConfig = {},
  userConfig = {},
  streaming = false,
}) {
  const resolvedModelSpec = resolveModelSpecByName({
    modelName,
    globalConfig,
    userConfig,
    fallbackToDefault: false,
  });
  if (!resolvedModelSpec) {
    throw fatalSystemError(
      `${tSystem("model.enabledProviderModelNotFound")}: ${String(modelName || "")}`,
      {
        code: "FATAL_MODEL_NOT_FOUND",
        details: { modelName: String(modelName || "") },
      },
    );
  }
  const providerFormat = normalizeProviderFormat(resolvedModelSpec);
  const modelInstance = createChatModelFromSpec(resolvedModelSpec, { streaming });
  const userText = String(text || "").trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const attachmentBlocks = normalizedAttachments
    .map((attachmentItem) =>
      buildAttachmentContentBlock(attachmentItem, providerFormat),
    )
    .filter(Boolean);
  const messageContent = attachmentBlocks.length
    ? [{ type: "text", text: userText }, ...attachmentBlocks]
    : userText;
  const modelResponse = await modelInstance.invoke([
    new HumanMessage({ content: messageContent }),
  ]);
  return {
    response: modelResponse,
    text: normalizeModelOutputContent(modelResponse?.content),
    modelSpec: normalizeModelSpecWithDefaults(resolvedModelSpec),
  };
}
