import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

function resolveRawDataInfo(rawData) {
  const rawDataType = Buffer.isBuffer(rawData) ? "buffer" : typeof rawData;
  const rawText = String(rawData || "");
  return {
    rawDataType,
    rawDataLength: rawText.length,
  };
}

export function writeAgentProxyInvalidJsonPayloadEvent({
  rawData,
  workspaceRoot,
} = {}) {
  return writeRoutedRuntimeEvent({
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.AGENT_PROXY_WEB_SOCKET,
    category: RUNTIME_EVENT_CATEGORIES.TRANSPORT,
    level: "warn",
    event: "agentProxy.ws.invalidJsonPayload",
    workspaceRoot,
    data: resolveRawDataInfo(rawData),
  });
}
