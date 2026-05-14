/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createConnectConnectorTool } from "../base-connector-tool.js";
import {
  emailFields,
  normalizeProvidedEmailDefaults,
} from "./connector-fields.js";

export function createEmailConnectorTools(context = {}) {
  return [
    createConnectConnectorTool({
      connectorType: "email",
      toolName: "email_connect_connector",
      normalizeDefaults: normalizeProvidedEmailDefaults,
      getFields: (_type, locale) => emailFields("", locale),
      context,
    }),
  ];
}
