import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

export function writeAgentProxyHttpServerListenStartedEvent({
  host,
  port,
  workspaceRoot,
} = {}) {
  return writeRoutedRuntimeEvent({
    scope: "startup",
    source: "agent-proxy",
    channel: RUNTIME_EVENT_CHANNELS.DIRECT,
    category: RUNTIME_EVENT_CATEGORIES.STATE,
    level: "info",
    event: "agentProxy.startup.httpServer.listen.started",
    workspaceRoot,
    data: {
      host,
      port,
    },
  });
}
