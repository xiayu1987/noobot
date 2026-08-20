/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_TOOL_SCHEMA = {
  access_connector: {
    description: {
      key: "tools.access_connector.description",
      text: "Access one connector selected by the user for this session. The connector must already be connected.",
    },
    params: {
      connector_id: {
        key: "tools.access_connector.fieldConnectorId",
        text: "Stable ID of a connector selected for this session.",
      },
      operation: {
        key: "tools.access_connector.fieldOperation",
        text: "Registered operation exposed by the selected connector instance.",
      },
      input: {
        key: "tools.access_connector.fieldInput",
        text: "Input object defined by the selected connector operation.",
      },
    },
    texts: {},
  },
};
