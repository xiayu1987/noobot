/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  DEFAULT_MIME_TYPE,
  MIME_TO_EXTENSION,
} from "../constants/index.js";
export { DEFAULT_MIME_TYPE, MIME_TO_EXTENSION };

export const DEFAULT_ATTACHMENT_SESSION_ID = "unknown_session";
export const DEFAULT_ATTACHMENT_SOURCE = "user";
export const ATTACHMENT_SOURCES = new Set(["user", "model", "email", "subtask"]);

export const MAX_EXTENSION_LENGTH = 20;
