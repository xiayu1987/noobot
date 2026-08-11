/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export { relaySeparateModelOutputAsUserMessage } from "../shared/relay-model-output.js";

export {
  CAPABILITY_DOMAIN,
  GUIDANCE_REASON,
  GUIDANCE_WEB_TOOL_NAMES,
  LOCALE,
  PROMPT_ENVELOPE,
  TOOL_NAME_SET,
} from "../shared/constants.js";

export { ensureHarnessBucket } from "../shared/bucket-utils.js";

export {
  appendCapabilityLog,
  appendCapabilityModelTraceLog,
  normalizeTransferPayload,
  saveCapabilityOutputAsTransferArtifacts,
} from "../shared/attachment-log-utils.js";

export {
  resolveCapabilityModelInvoker,
  resolveCapabilityModelMessages,
  resolveCapabilityModelName,
  resolveCapabilityToolAllowlist,
} from "../shared/model/utils.js";

export {
  extractRawTextContent,
  shouldSkipAnalysisForTrailingToolCallContent,
} from "../shared/message/utils.js";
export {
  buildCapabilityModelMessages,
  buildCapabilityProtocolModelMessages,
} from "../shared/model/message-factory.js";
export { invokeCapabilityModel } from "../shared/model/invocation-utils.js";

export { HARNESS_I18N_KEYSET, translateI18nText } from "../shared/i18n.js";
