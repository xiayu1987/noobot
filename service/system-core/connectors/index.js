/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * connectors 统一入口 — 公共 API
 */

// Channel Store
export { initConnectorChannelStore, getConnectorChannelStore } from "./channel-store.js";

// History Store
export { initConnectorHistoryStore, getConnectorHistoryStore } from "./history-store.js";

// Event Listener
export { ConnectorEventListener, createConnectorEventListener } from "./connector-event-listener.js";

// Database Connector
export { executeDatabaseCommand } from "./databases/index.js";

// Terminal Connector
export { executeTerminalCommand, releaseTerminalChannel } from "./terminals/index.js";

// Email Connector
export { executeEmailCommand } from "./emails/index.js";
