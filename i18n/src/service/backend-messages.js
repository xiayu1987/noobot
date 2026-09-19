/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { toBilingualDict } from "../shared/bilingual-dict.js";
import zhCN from "./locales/zh-CN.js";
import enUS from "./locales/en-US.js";

export const BACKEND_I18N = toBilingualDict(zhCN, enUS);
