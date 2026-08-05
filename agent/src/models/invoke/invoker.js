/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HumanMessage } from "@langchain/core/messages";
import { fatalSystemError } from "../../shared/errors/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { normalizeProviderFormat } from "../../config/core/enums.js";
import { normalizeModelSpecWithDefaults } from "../spec/normalizer.js";
import { resolveModelSpecByName } from "../resolver/index.js";
import { createChatModelFromSpec } from "../factory/chat-model.js";
import { buildAttachmentContentBlock, normalizeModelOutputContent } from "../attachment/formatter.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";

export async function invokeModelWithTextAndAttachments({
  modelName = "",
  text = "",
  attachments = [],
  globalConfig = {},
  userConfig = {},
  streaming = false,
  context = {},
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
        code: ERROR_CODE.FATAL_MODEL_NOT_FOUND,
        details: { modelName: String(modelName || "") },
      },
    );
  }
  const providerFormat = normalizeProviderFormat(resolvedModelSpec?.format || "");
  const modelInstance = createChatModelFromSpec(resolvedModelSpec, {
    streaming,
    context,
    invocation: context?.invocation,
  });
  const userText = String(text || "").trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const attachmentBlocks = normalizedAttachments
    .map((attachmentItem) =>
      buildAttachmentContentBlock({
        attachment: attachmentItem,
        providerFormat,
      }),
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
