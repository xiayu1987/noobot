import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

function parseChannelKeyPart(channelKey = "", index = 0) {
  return String(channelKey || "").split("::")[index]?.trim() || "";
}

export function writeAgentProxyRouteDebugEvent({
  event = "agentProxy.route.debug",
  payload = {},
  socket = null,
  channel = null,
  data = {},
  workspaceRoot,
} = {}) {
  const sessionId = String(payload?.sessionId || data?.sessionId || channel?.startPayload?.sessionId || parseChannelKeyPart(channel?.key, 1) || "").trim();
  const userId = String(payload?.userId || socket?.__agentProxyUserId || data?.userId || channel?.ownerUserId || channel?.startPayload?.userId || parseChannelKeyPart(channel?.key, 0) || "").trim();
  return writeRoutedRuntimeEvent({
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.DEBUG,
    level: "debug",
    event,
    userId,
    sessionId,
    dialogProcessId: String(payload?.dialogProcessId || data?.dialogProcessId || "").trim(),
    turnScopeId: String(payload?.turnScopeId || data?.turnScopeId || "").trim(),
    workspaceRoot,
    data: {
      debugType: "agent-proxy-route",
      action: String(payload?.action || data?.action || "").trim().toLowerCase(),
      payloadSessionId: String(payload?.sessionId || "").trim(),
      payloadUserIdPresent: Boolean(payload?.userId),
      payloadChannelKeyPresent: Boolean(payload?.channelKey),
      socketUserIdPresent: Boolean(socket?.__agentProxyUserId),
      socketActiveChannelKeyPresent: Boolean(socket?.__agentProxyActiveChannelKey),
      targetChannelKey: String(channel?.key || data?.targetChannelKey || ""),
      channelStatus: String(channel?.status || data?.channelStatus || ""),
      upstreamReadyState: channel?.upstreamSocket?.readyState ?? data?.upstreamReadyState ?? null,
      ...data,
    },
  });
}
