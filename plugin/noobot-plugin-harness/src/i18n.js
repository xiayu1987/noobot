/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */


import { LOCALE } from "./i18n/locale.js";
import { I18N_TOOL_COPY } from "./i18n/tool-copy.js";
import { I18N_RUNTIME_LABELS } from "./i18n/runtime-labels.js";

export { LOCALE } from "./i18n/locale.js";
export { HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS } from "./i18n/scenario-policy-texts.js";
export { HARNESS_I18N_KEYSET } from "./i18n/keyset.js";
export {
  DEFAULT_TASK_OWNER,
  DEFAULT_SUBTASK_OWNERS,
  DEFAULT_TASK_TEMPLATE,
  PROMPT_JSON_FORMAT_EXAMPLES,
} from "./i18n/defaults.js";

export const I18N_TEXT = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    ...I18N_TOOL_COPY[LOCALE.ZH_CN],
    ...I18N_RUNTIME_LABELS[LOCALE.ZH_CN],
  }),
  [LOCALE.EN_US]: Object.freeze({
    ...I18N_TOOL_COPY[LOCALE.EN_US],
    ...I18N_RUNTIME_LABELS[LOCALE.EN_US],
  }),
});
