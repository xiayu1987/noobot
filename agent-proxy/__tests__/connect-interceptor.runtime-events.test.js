import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = String(body || '');
    },
  };
}

test('connect interceptor writes sanitized system event for invalid upstream base URL', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'agent-proxy-connect-system-events-'));
  const previousRuntimeEventsWorkspaceRoot = process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
  const previousBase = process.env.AGENT_PROXY_UPSTREAM_HTTP_BASE;
  process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = workspaceRoot;
  process.env.AGENT_PROXY_UPSTREAM_HTTP_BASE = 'http://[?apikey=secret-token';

  try {
    const moduleUrl = `../src/connect-interceptor.js?case=${Date.now()}`;
    const { interceptConnectRequest } = await import(moduleUrl);
    const response = createMockResponse();
    await interceptConnectRequest(
      {
        method: 'POST',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
        on(eventName, handler) {
          if (eventName === 'data') return;
          if (eventName === 'end') queueMicrotask(handler);
        },
      },
      response,
      { saveApiKeyIdentity() {} },
    );

    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.body), { ok: false, error: 'Bad Gateway' });

    const eventFile = path.join(
      workspaceRoot,
      'system',
      'runtime',
      'events',
      'system',
      'agent-proxy',
      'config.jsonl',
    );
    await waitForFile(eventFile);
    const raw = await readFile(eventFile, 'utf8');
    const records = raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const record = records.find((item) => item.event === 'agentProxy.connect.upstreamBaseUrl.invalid');

    assert.ok(record);
    assert.equal(record.scope, 'system');
    assert.equal(record.source, 'agent-proxy');
    assert.equal(record.category, 'config');
    assert.equal(record.level, 'error');
    assert.equal(record.channel, 'direct');
    assert.equal(record.sessionId, undefined);
    assert.equal(record.workspaceRoot, undefined);
    assert.equal(record.data.upstreamHttpBaseLength, 'http://[?apikey=secret-token'.length);
    assert.ok(record.error?.message);
    assert.equal(JSON.stringify(record).includes('secret-token'), false);
    assert.equal(JSON.stringify(record).includes('apikey='), false);
  } finally {
    if (previousRuntimeEventsWorkspaceRoot === undefined) delete process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
    else process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = previousRuntimeEventsWorkspaceRoot;
    if (previousBase === undefined) delete process.env.AGENT_PROXY_UPSTREAM_HTTP_BASE;
    else process.env.AGENT_PROXY_UPSTREAM_HTTP_BASE = previousBase;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
