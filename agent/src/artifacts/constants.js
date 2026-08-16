/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_MIME_TYPE, MIME_TO_EXTENSION } from "../shared/constants/index.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
export { DEFAULT_MIME_TYPE, MIME_TO_EXTENSION };

export const VALID_ATTACHMENT_SOURCES = new Set(["user", "model", "email", "subtask"]);

export const MAX_EXTENSION_LENGTH = LENGTH_THRESHOLDS.preview.attachmentExtensionChars;
