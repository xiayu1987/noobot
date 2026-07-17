/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeAgentProxyHttpServerListenStartedEvent } from '../src/startup-events.js';

async function waitForFile(filePath, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

test('agent-proxy writes startup runtime event when HTTP server starts listening', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'agent-proxy-startup-events-'));
  const eventFile = path.join(
    workspaceRoot,
    'system',
    'runtime',
    'events',
    'startup',
    'agent-proxy',
    'state.jsonl',
  );

  try {
    const result = await writeAgentProxyHttpServerListenStartedEvent({
      host: '127.0.0.1',
      port: 12345,
      workspaceRoot,
    });

    assert.equal(result.ok, true);
    await waitForFile(eventFile);
    const raw = await readFile(eventFile, 'utf8');
    const records = raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const record = records.find((item) => item.event === 'agentProxy.startup.httpServer.listen.started');

    assert.ok(record);
    assert.equal(record.scope, 'startup');
    assert.equal(record.source, 'agent-proxy');
    assert.equal(record.category, 'state');
    assert.equal(record.level, 'info');
    assert.equal(record.channel, 'direct');
    assert.equal(record.sessionId, undefined);
    assert.equal(record.workspaceRoot, workspaceRoot);
    assert.equal(record.data.host, '127.0.0.1');
    assert.equal(record.data.port, 12345);
    assert.ok(record.process?.pid);
    assert.equal(JSON.stringify(record).includes('apikey=secret'), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
