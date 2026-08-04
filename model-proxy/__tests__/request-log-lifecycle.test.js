/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

import {
  createProxyServer,
  createRequestLogLifecycle,
} from '../src/server.js';

function createRecordingLogger() {
  const requests = [];
  const terminals = [];
  let resolveTerminal;
  const terminalWritten = new Promise((resolve) => {
    resolveTerminal = resolve;
  });
  return {
    requests,
    terminals,
    terminalWritten,
    logRequest: (value) => requests.push(value),
    logTerminal: (value) => {
      terminals.push(value);
      resolveTerminal(value);
    },
  };
}

test('request log lifecycle writes exactly one terminal record', () => {
  const logger = createRecordingLogger();
  const lifecycle = createRequestLogLifecycle({
    logger,
    context: { sessionId: 'session-1', flowName: 'agent.main' },
  });

  assert.equal(lifecycle.recordRequest({ bodyText: '{}' }), true);
  assert.equal(lifecycle.settle({ outcome: 'client_aborted' }), true);
  assert.equal(lifecycle.settle({ outcome: 'proxy_error' }), false);
  assert.equal(logger.requests.length, 1);
  assert.equal(logger.terminals.length, 1);
  assert.equal(logger.terminals[0].outcome, 'client_aborted');
  assert.equal(logger.terminals[0].sessionId, 'session-1');
});

test('terminal observed before request completion is written after Request', () => {
  const logger = createRecordingLogger();
  const lifecycle = createRequestLogLifecycle({ logger });

  assert.equal(lifecycle.settle({ outcome: 'proxy_error' }), true);
  assert.equal(logger.terminals.length, 0);
  assert.equal(lifecycle.recordRequest({ bodyText: 'partial', bodyComplete: false }), true);
  assert.equal(logger.requests.length, 1);
  assert.equal(logger.terminals.length, 1);
  assert.equal(logger.terminals[0].outcome, 'proxy_error');
  assert.equal(lifecycle.terminalLogged, true);
});

test('client disconnect closes a recorded proxy request with one terminal', async (t) => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('partial');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });

  const logger = createRecordingLogger();
  const proxyServer = createProxyServer({
    localPort: 0,
    targetUrl: `http://127.0.0.1:${upstream.address().port}`,
    proxyHost: '127.0.0.1',
    logger,
    buildRequestCacheDiagnostics: () => ({}),
    headerExtractors: {
      extractModelNameFromHeaders: () => 'test-model',
      extractFlowFromHeaders: () => 'agent.main',
      extractSessionIdFromHeaders: () => 'session-abort',
      extractParentSessionIdFromHeaders: () => '',
    },
    unknownModelName: 'unknown-model',
    unknownFlowName: 'unknown-flow',
    unknownSessionId: 'unknown-session',
  });
  await once(proxyServer, 'listening');
  t.after(() => {
    proxyServer.closeAllConnections();
    proxyServer.close();
  });

  await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxyServer.address().port,
      method: 'POST',
      path: '/v1/responses',
    });
    req.on('error', reject);
    req.on('response', (res) => {
      res.once('data', () => {
        res.destroy();
        resolve();
      });
    });
    req.end('{}');
  });

  let terminalTimeout;
  try {
    await Promise.race([
      logger.terminalWritten,
      new Promise((_, reject) => {
        terminalTimeout = setTimeout(
          () => reject(new Error('proxy terminal log timeout')),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(terminalTimeout);
  }
  assert.equal(logger.requests.length, 1);
  assert.equal(logger.terminals.length, 1);
  assert.equal(logger.terminals[0].outcome, 'client_aborted');
  assert.equal(logger.terminals[0].sessionId, 'session-abort');
});
