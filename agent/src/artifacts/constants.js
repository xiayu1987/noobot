/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { DEFAULT_MIME_TYPE, MIME_TO_EXTENSION } from "@noobot/attachment-protocol/mime";
export { DEFAULT_MIME_TYPE, MIME_TO_EXTENSION };

export const VALID_ATTACHMENT_SOURCES = new Set(Object.values(ATTACHMENT_SOURCE));
