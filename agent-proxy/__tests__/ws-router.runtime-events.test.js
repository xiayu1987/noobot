import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WsRouter } from '../src/ws-router.js';
import { AGENT_PROXY_ERROR, CHANNEL_EVENT } from '../src/constants.js';

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function createMockSocket() {
  const handlers = new Map();
  return {
    __agentProxyApiKey: 'api-key-1',
    __agentProxyUserId: 'user-1',
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    emit(eventName, data) {
      const handler = handlers.get(eventName);
      if (handler) handler(data);
    },
  };
}

function createForwardingChannelManager({
  targetChannel = { key: 'channel-1' },
  hasPermission = true,
  forwardResult = true,
} = {}) {
  const calls = {
    resolve: [],
    permission: [],
    forward: [],
    errors: [],
  };
  return {
    calls,
    resolveChannelFromSocketMessage(socket, payload) {
      calls.resolve.push({ socket, payload });
      return targetChannel;
    },
    hasChannelPermission(channel, apiKey, userId) {
      calls.permission.push({ channel, apiKey, userId });
      return hasPermission;
    },
    forwardToUpstream(channel, payload) {
      calls.forward.push({ channel, payload });
      return forwardResult;
    },
    sendSocketError(socket, message) {
      calls.errors.push({ socket, message });
    },
  };
}

for (const action of ['continue', 'resume']) {
  test(`ws router forwards ${action} action to upstream`, () => {
    const channelManager = createForwardingChannelManager();
    const socket = createMockSocket();
    const payload = {
      action,
      userId: 'user-1',
      sessionId: 'session-1',
      dialogProcessId: 'dialog-new',
      turnScopeId: 'turn-new',
      config: {
        resumeDialogProcessId: 'dialog-stopped',
        resumeTurnScopeId: 'turn-stopped',
        stoppedTurnScopeId: 'turn-stopped',
      },
    };

    new WsRouter(channelManager).handle(socket, 'connection-api-key', 'en');
    socket.emit(CHANNEL_EVENT.MESSAGE, JSON.stringify(payload));

    assert.equal(channelManager.calls.errors.length, 0);
    assert.equal(channelManager.calls.resolve.length, 1);
    assert.equal(channelManager.calls.permission.length, 1);
    assert.equal(channelManager.calls.permission[0].apiKey, 'api-key-1');
    assert.equal(channelManager.calls.permission[0].userId, 'user-1');
    assert.equal(channelManager.calls.forward.length, 1);
    assert.deepEqual(channelManager.calls.forward[0].payload, payload);
  });
}

test('ws router reports upstream unavailable when continue action has no target channel', () => {
  const channelManager = createForwardingChannelManager({ targetChannel: null });
  const socket = createMockSocket();

  new WsRouter(channelManager).handle(socket, 'connection-api-key', 'en');
  socket.emit(CHANNEL_EVENT.MESSAGE, JSON.stringify({ action: 'continue', sessionId: 'session-1' }));

  assert.equal(channelManager.calls.forward.length, 0);
  assert.equal(channelManager.calls.errors.length, 1);
  assert.equal(channelManager.calls.errors[0].message, AGENT_PROXY_ERROR.UPSTREAM_UNAVAILABLE);
});

test('ws router restarts upstream on existing channel when continue action has closed upstream', () => {
  const targetChannel = {
    key: 'channel-1',
    apiKey: 'channel-api-key',
    locale: 'zh-CN',
    cleanupAfterMs: 123,
    upstreamClosed: true,
    _errorHandled: true,
  };
  const channelManager = createForwardingChannelManager({
    targetChannel,
    forwardResult: false,
  });
  channelManager.calls.close = [];
  channelManager.calls.connect = [];
  channelManager.closeUpstreamChannel = (channel, closeCode, reason) => {
    channelManager.calls.close.push({ channel, closeCode, reason });
  };
  channelManager.connectUpstreamChannel = (channel, apiKey, locale) => {
    channelManager.calls.connect.push({ channel, apiKey, locale });
  };
  const socket = createMockSocket();
  const payload = {
    action: 'continue',
    userId: 'user-1',
    sessionId: 'session-1',
    dialogProcessId: 'dialog-resume',
    turnScopeId: 'turn-resume',
    config: {
      resumeDialogProcessId: 'dialog-stopped',
      resumeTurnScopeId: 'turn-stopped',
      stoppedTurnScopeId: 'turn-stopped',
    },
  };

  new WsRouter(channelManager).handle(socket, 'connection-api-key', 'en');
  socket.emit(CHANNEL_EVENT.MESSAGE, JSON.stringify(payload));

  assert.equal(channelManager.calls.errors.length, 0);
  assert.equal(channelManager.calls.forward.length, 1);
  assert.equal(channelManager.calls.close.length, 1);
  assert.equal(channelManager.calls.connect.length, 1);
  assert.deepEqual(targetChannel.startPayload, payload);
  assert.equal(targetChannel.cleanupAfterMs, 0);
  assert.equal(targetChannel.upstreamClosed, false);
  assert.equal(targetChannel._errorHandled, false);
  assert.equal(channelManager.calls.connect[0].apiKey, 'api-key-1');
  assert.equal(channelManager.calls.connect[0].locale, 'zh-CN');
});

test('ws router denies continue action without channel permission', () => {
  const channelManager = createForwardingChannelManager({ hasPermission: false });
  const socket = createMockSocket();

  new WsRouter(channelManager).handle(socket, 'connection-api-key', 'en');
  socket.emit(CHANNEL_EVENT.MESSAGE, JSON.stringify({ action: 'continue', sessionId: 'session-1' }));

  assert.equal(channelManager.calls.forward.length, 0);
  assert.equal(channelManager.calls.errors.length, 1);
  assert.equal(
    channelManager.calls.errors[0].message,
    AGENT_PROXY_ERROR.PERMISSION_DENIED_FOR_ACTION('continue'),
  );
});

test('ws router writes sanitized system event for invalid JSON payload', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'agent-proxy-ws-system-events-'));
  const previousWorkspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  const previousDefaultWorkspaceRoot = process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
  delete process.env.NOOBOT_WORKSPACE_ROOT;
  process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = workspaceRoot;

  const eventFile = path.join(
    workspaceRoot,
    'system',
    'runtime',
    'events',
    'system',
    'agent-proxy',
    'transport.jsonl',
  );
  const sendSocketErrors = [];
  const channelManager = {
    sendSocketError(socket, message) {
      sendSocketErrors.push({ socket, message });
    },
  };
  const socket = createMockSocket();
  const rawData = '{"apikey":"secret-token","authorization":"Bearer hidden"';

  try {
    new WsRouter(channelManager).handle(socket, 'connection-api-key', 'en');
    socket.emit(CHANNEL_EVENT.MESSAGE, rawData);

    assert.equal(sendSocketErrors.length, 1);
    assert.equal(sendSocketErrors[0].socket, socket);
    assert.equal(sendSocketErrors[0].message, AGENT_PROXY_ERROR.INVALID_JSON_PAYLOAD);

    await waitForFile(eventFile);
    const raw = await readFile(eventFile, 'utf8');
    const records = raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const record = records.find((item) => item.event === 'agentProxy.ws.invalidJsonPayload');

    assert.ok(record);
    assert.equal(record.scope, 'system');
    assert.equal(record.source, 'agent-proxy');
    assert.equal(record.category, 'transport');
    assert.equal(record.level, 'warn');
    assert.equal(record.channel, 'agent-proxy-ws');
    assert.equal(record.sessionId, undefined);
    assert.equal(record.workspaceRoot, undefined);
    assert.equal(record.data.rawDataType, 'string');
    assert.equal(record.data.rawDataLength, rawData.length);
    assert.equal(JSON.stringify(record).includes('secret-token'), false);
    assert.equal(JSON.stringify(record).includes('authorization'), false);
    assert.equal(JSON.stringify(record).includes('apikey'), false);
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.NOOBOT_WORKSPACE_ROOT;
    else process.env.NOOBOT_WORKSPACE_ROOT = previousWorkspaceRoot;
    if (previousDefaultWorkspaceRoot === undefined) delete process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
    else process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = previousDefaultWorkspaceRoot;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
