/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AGENT_TRANSPORT_ERROR_CODE } from "@noobot/agent-transport-protocol";
import { AGENT_PROXY_CLOSE_REASON } from "../shared/constants.js";

export function authenticateDownstreamSocket({ socket, requestInfo, channelManager, close }) {
  socket.__agentProxyApiKey = requestInfo.apiKey;
  socket.__agentProxyLocale = requestInfo.locale;
  const socketIdentity = channelManager.resolveApiKeyIdentity(requestInfo.apiKey);
  if (socketIdentity) {
    socket.__agentProxyUserId = socketIdentity.userId;
    return true;
  }
  channelManager.sendSocketError(socket, {
    code: AGENT_TRANSPORT_ERROR_CODE.UNAUTHENTICATED,
    identity: {},
  });
  close(socket, { code: 1008, reason: AGENT_PROXY_CLOSE_REASON.UNAUTHENTICATED });
  return false;
}
