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
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    emit(eventName, data) {
      const handler = handlers.get(eventName);
      if (handler) handler(data);
    },
  };
}

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
