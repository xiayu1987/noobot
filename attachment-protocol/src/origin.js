/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalLocator } from "@noobot/shared/locator";
import { AttachmentProtocolError } from "./errors.js";

export function parseOrigin(value) {
  if (value === undefined) return undefined;
  if (!isCanonicalLocator(value)) throw new AttachmentProtocolError("invalid_attachment_origin");
  return Object.freeze({ ...value });
}
