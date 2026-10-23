/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { randomUUID } from "node:crypto";

export function initializeDownstreamSocketState(socket) {
  socket.__agentProxySocketId = randomUUID();
  socket.__agentProxyChannelKeys = new Set();
  socket.__agentProxyLastSequenceByChannel = {};
  socket.__agentProxyPendingLifecycleDeliveries = new Map();
  socket.__agentProxyLifecycleDeliveriesByTurn = new Map();
  socket.__agentProxyReconnectTransaction = null;
  return socket;
}
