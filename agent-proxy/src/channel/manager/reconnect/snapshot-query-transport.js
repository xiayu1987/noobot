/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_SNAPSHOT_WIRE_EVENT } from "@noobot/session-protocol/turn-lifecycle";
import {
  AGENT_TRANSPORT_EVENT,
  AGENT_COMMAND_RECEIPT_OUTCOME,
} from "@noobot/agent-transport-protocol";
import { createWebSocketAuthProtocols } from "@noobot/shared/websocket-auth";
import { config } from "../../../shared/config.js";

function routeQueryReply(manager, pendingCommandId, rawData, settle) {
  const { eventName, eventData } = manager.parseUpstreamMessage(rawData);
  if (eventName === TURN_SNAPSHOT_WIRE_EVENT) {
    if (eventData.causality.commandId === pendingCommandId) {
      settle({ ok: true, snapshot: eventData });
    }
    return;
  }
  if (
    eventName === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT &&
    eventData.outcome === AGENT_COMMAND_RECEIPT_OUTCOME.FAILED &&
    eventData.commandId === pendingCommandId
  ) {
    settle({ ok: false, reason: eventData.error.code });
  }
}

export function connectSnapshotQuery(manager, request, socket, initialCommand) {
  const transport = manager.createUpstreamTransport();
  const { settle } = request;
  const fail = (reason) => settle({ ok: false, reason });
  const send = (command) => {
    try {
      if (transport.send(JSON.stringify(command))) {
        manager.logForwardSent(request.channel, command);
        return;
      }
    } catch (error) {
      manager.logForwardError(request.channel, command, error);
    }
    fail("snapshot_query_send_failed");
  };
  const connection = transport.connect(
    config.upstreamWsUrl,
    {
      open: () => send(initialCommand),
      message: ({ rawData }) => routeQueryReply(manager, request.pendingCommandId, rawData, settle),
      close: () => fail("snapshot_query_closed"),
      error: () => fail("snapshot_query_transport_error"),
      handlerError: () => fail("snapshot_query_invalid_reply"),
    },
    {
      purpose: "snapshot_query",
      protocols: createWebSocketAuthProtocols(socket.__agentProxyApiKey),
    },
  );
  if (!connection) fail("snapshot_query_connect_failed");
  return { send, close: (reason) => transport.close(1000, reason) };
}
