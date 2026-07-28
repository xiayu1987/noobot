/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export {
  isProviderEnabled,
  getProviders,
  getEnabledProviders,
  pickAlias,
  byAliasWithUser,
  firstEnabledAlias,
} from "./provider/resolver.js";

export {
  normalizeModelSpecInput,
  toFiniteNumber,
  clampNumber,
  normalizeModelParamValue,
  hasOwnValue,
  normalizeModelSpecWithDefaults,
} from "./spec/normalizer.js";

export {
  MODEL_DEFAULT_FIELDS_BY_FORMAT,

  getModelDefaultFields,
} from "./spec/defaults.js";

export {
  resolveDefaultModelSpec,
  resolveModelSpecByAlias,
  resolveModelSpecByName,
  resolveSkillModelSpec,
  setModelAdapter,
  getModelAdapter,
  resetModelAdapter,
} from "./adapter.js";

export {
  createChatModelFromSpec,
  createChatModel,
  createChatModelByName,
} from "./adapter.js";
export { resolveApiKey, buildModelKwargs, resolveUseResponsesApi } from "./factory/chat-model.js";

export { invokeModelWithTextAndAttachments } from "./invoke/invoker.js";
export {
  normalizeToolCallArgs,
  resolveRawToolCalls,
  normalizeToolCalls,
} from "./invoke/tool-call-normalizer.js";

export {
  resolveInvokeLlm,
  resolveRetryInvokeLlm,
  registerToolCallStreamingMismatch,
  shouldRetryToolCallStreamingMismatch,
} from "./invoke/llm-adapter.js";

export {
  buildAttachmentContentBlock,
  normalizeModelOutputContent,
} from "./attachment/formatter.js";

export { adaptToolsForBinding } from "./tool/binding-adapter.js";
export {
  buildToolCompatibilityLogLine,
  appendToolCompatibilityLog,
} from "./tool/compatibility-log.js";

export { isSameModelSpec } from "./utils/model-compare.js";
