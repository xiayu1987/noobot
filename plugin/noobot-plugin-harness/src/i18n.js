/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

// Harness i18n 装配层。
// 具体常量按语义拆到 ./i18n/ 子模块，这里只重导出公开面并合成 I18N_TEXT。
// 公开导出（供 handlers/shared/i18n.js 等引用）：
//   LOCALE, HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS, HARNESS_I18N_KEYSET,
//   DEFAULT_TASK_OWNER, DEFAULT_SUBTASK_OWNERS, DEFAULT_TASK_TEMPLATE,
//   PROMPT_JSON_FORMAT_EXAMPLES, I18N_TEXT

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

// Localized dictionary used by harness.
// Merge tool copy + runtime labels into a single frozen dictionary per locale.
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
