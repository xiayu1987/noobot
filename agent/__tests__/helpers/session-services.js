/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AttachmentService } from "../../src/artifacts/index.js";
import { createSessionServices } from "../../src/session/index.js";

export function createTestSessionServices(globalConfig, options = {}) {
  return createSessionServices(globalConfig, {
    ...options,
    attachmentService: new AttachmentService(globalConfig),
  });
}
