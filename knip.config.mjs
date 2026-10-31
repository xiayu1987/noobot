/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createDeadCodeConfig } from "./scripts/quality/dead-code-config.mjs";

export default await createDeadCodeConfig(import.meta.dirname);
