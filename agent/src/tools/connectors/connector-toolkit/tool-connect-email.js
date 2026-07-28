/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createConnectConnectorTool } from "../base-connector-tool.js";
import { CONNECTOR_TYPE } from "../../constants/index.js";
import {
  emailFields,
  normalizeProvidedEmailDefaults,
} from "./connector-fields.js";

export function createEmailConnectorTools(context = {}) {
  return [
    createConnectConnectorTool({
      connectorType: CONNECTOR_TYPE.EMAIL,
      toolName: CONNECTOR_TYPE.CONNECT_TOOL_NAME.EMAIL,
      normalizeDefaults: normalizeProvidedEmailDefaults,
      getFields: (_type, locale) => emailFields("", locale),
      context,
    }),
  ];
}
