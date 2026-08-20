/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONNECTOR_TOOL_SCHEMA = {
  access_connector: {
    description: {
      key: "tools.access_connector.description",
      text: "访问用户为当前会话勾选且已连接的连接器。",
    },
    params: {
      connector_id: {
        key: "tools.access_connector.fieldConnectorId",
        text: "当前会话已勾选连接器的稳定 ID。",
      },
      operation: {
        key: "tools.access_connector.fieldOperation",
        text: "所选连接器实例公开的已注册操作。",
      },
      input: {
        key: "tools.access_connector.fieldInput",
        text: "所选连接器操作定义的输入对象。",
      },
    },
    texts: {},
  },
};
