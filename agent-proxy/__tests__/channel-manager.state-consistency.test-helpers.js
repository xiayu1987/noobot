export function createMockSocket({ apiKey = "api-key-1", userId = "user-1" } = {}) {
  return {
    readyState: 1,
    sentEvents: [],
    __agentProxyChannelKeys: new Set(),
    __agentProxyApiKey: apiKey,
    __agentProxyUserId: userId,
    send(raw) {
      this.sentEvents.push(JSON.parse(String(raw || "{}")));
    },
  };
}

export function getEvent(socket, eventName) {
  return socket.sentEvents.find((eventItem) => eventItem?.event === eventName) || null;
}

export function listEvents(socket, eventName) {
  return socket.sentEvents.filter((eventItem) => eventItem?.event === eventName);
}

export class FakeUpstreamWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeUpstreamWebSocket.OPEN;
    this.handlers = new Map();
    this.sent = [];
    FakeUpstreamWebSocket.instances.push(this);
  }

  on(eventName, handler) {
    this.handlers.set(eventName, handler);
  }

  emit(eventName, ...args) {
    this.handlers.get(eventName)?.(...args);
  }

  send(raw) {
    this.sent.push(String(raw || ""));
  }

  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.emit("close", code, Buffer.from(String(reason || "")));
  }
}

export function sortReconnectSessions(payload = {}) {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  return sessions
    .map((sessionEntry) => ({
      sessionId: String(sessionEntry?.sessionId || ""),
      hasRunningTask: Boolean(sessionEntry?.hasRunningTask),
      dialogProcesses: (Array.isArray(sessionEntry?.dialogProcesses)
        ? sessionEntry.dialogProcesses
        : []
      )
        .map((dialogProcess) => ({
          dialogProcessId: String(dialogProcess?.dialogProcessId || ""),
          messages: (Array.isArray(dialogProcess?.messages) ? dialogProcess.messages : []).map(
            (envelope) => ({
              event: String(envelope?.event || ""),
              seq: Number(envelope?.data?.seq || 0),
              requestId: String(envelope?.data?.requestId || ""),
              pending: envelope?.data?.__agentProxyPendingInteraction === true,
            }),
          ),
        }))
        .sort((left, right) => left.dialogProcessId.localeCompare(right.dialogProcessId)),
    }))
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}
