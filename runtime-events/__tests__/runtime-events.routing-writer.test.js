/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  RUNTIME_EVENTS_CONFIG_DEFAULTS,
  RUNTIME_EVENTS_CONFIG_ENVS,
} from '@noobot/shared/runtime-events-config';
import {
  createRuntimeEventWriter,
  normalizeRuntimeEvent,
  writeRoutedRuntimeEvent,
  writeRuntimeEvent,
  writeSessionRuntimeEvent,
  writeStartupEvent,
  writeSystemRuntimeEvent,
} from '../src/index.js';
import { writeSessionChannelEvent, SESSION_CHANNELS } from '../src/session-channel.js';
import {
  buildSessionLogRecord,
  getSessionLogControlKey,
  getSessionLogDebugControlKey,
  normalizeSessionLogCategory,
  SESSION_LOG_CATEGORIES,
  SESSION_LOG_DEBUG_CATEGORY,
  SESSION_LOG_DEFAULT_CATEGORY,
  SESSION_LOG_RECORD_FIELDS,
} from '../src/session-log-protocol.js';
import {
  markSessionDeleted,
  pathExists,
  persistSession,
  readJsonl,
  tempRoot,
  writeArchive,
} from './runtime-events-test-fixtures.js';

test('session runtime event requires userId and sessionId', async () => {
  const result = await writeSessionRuntimeEvent({
    source: 'agent',
    category: 'system',
    level: 'error',
    event: 'agent.session.missingContext',
  });

  assert.equal(result.ok, false);
  assert.match(result.error.message, /requires userId and sessionId/);
});

test('startup and system events write JSONL without session context', async () => {
  const workspaceRoot = await tempRoot();
  const startup = await writeStartupEvent({
    source: 'service',
    category: 'state',
    level: 'info',
    event: 'service.startup.listen.started',
    workspaceRoot,
    data: { port: 3000 },
  });
  const system = await writeSystemRuntimeEvent({
    source: 'agent',
    category: 'transport',
    level: 'warn',
    event: 'agent.runtime.queue.timeout',
    workspaceRoot,
  });

  assert.equal(startup.ok, true);
  assert.equal(system.ok, true);
  assert.match(startup.file, /runtime\/events\/startup\/service\/state\.jsonl$/);
  assert.match(system.file, /runtime\/events\/system\/agent\/transport\.jsonl$/);
  assert.equal((await readJsonl(startup.file))[0].scope, 'startup');
  assert.equal((await readJsonl(system.file))[0].scope, 'system');
});

test('session runtime events write to runtime session events path', async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, 'admin', 's_1');
  const result = await writeRuntimeEvent({
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'error',
    event: 'agent.doc2data.failed',
    userId: 'admin',
    sessionId: 's:1',
    dialogProcessId: 'dialog-1',
    turnScopeId: 'turn-1',
    workspaceRoot,
  });

  assert.equal(result.ok, true);
  assert.match(result.file, /admin\/runtime\/session\/s_1\/events\/system\.jsonl$/);
  const [record] = await readJsonl(result.file);
  assert.equal(record.sessionId, 's_1');
  assert.equal(record.userId, 'admin');
  assert.equal(record.dialogProcessId, 'dialog-1');
});

test('routed runtime events write session when full session context exists', async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, 'admin', 'session_1');
  const result = await writeRoutedRuntimeEvent({
    source: 'agent',
    category: 'system',
    level: 'warn',
    event: 'agent.routed.session',
    userId: 'admin',
    sessionId: 'session:1',
    workspaceRoot,
    data: { token: 'secret', count: 1 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.scope, 'session');
  assert.equal(result.record.sessionId, 'session_1');
  assert.equal(result.record.data.token, '[Redacted]');
  assert.match(result.file, /admin\/runtime\/session\/session_1\/events\/system\.jsonl$/);
});

test('routed runtime events write system without session context', async () => {
  const workspaceRoot = await tempRoot();
  const result = await writeRoutedRuntimeEvent({
    source: 'service',
    category: 'config',
    level: 'warn',
    event: 'service.routed.system',
    workspaceRoot,
    data: { authorization: 'Bearer secret', reason: 'parse-failed' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.scope, 'system');
  assert.equal(result.record.sessionId, undefined);
  assert.equal(result.record.data.authorization, '[Redacted]');
  assert.match(result.file, /runtime\/events\/system\/service\/config\.jsonl$/);
});

test('routed runtime events use default configured workspace when no root is provided', async () => {
  const previousWorkspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  const previousDefaultWorkspaceRoot = process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
  const defaultWorkspaceRoot = await tempRoot();
  try {
    delete process.env.NOOBOT_WORKSPACE_ROOT;
    process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = defaultWorkspaceRoot;
    const result = await writeRoutedRuntimeEvent({
      source: 'agent-proxy',
      scope: 'startup',
      category: 'state',
      level: 'info',
      event: 'agentProxy.default.startup',
    });

    assert.equal(result.ok, true);
    assert.equal(result.record.workspaceRoot, undefined);
    assert.match(result.file, new RegExp(`${defaultWorkspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*runtime/events/startup/agent-proxy/state\\.jsonl$`));
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.NOOBOT_WORKSPACE_ROOT;
    else process.env.NOOBOT_WORKSPACE_ROOT = previousWorkspaceRoot;
    if (previousDefaultWorkspaceRoot === undefined) delete process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
    else process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = previousDefaultWorkspaceRoot;
  }
});

test('runtimeEventsRoot option writes under explicit root before default workspace', async () => {
  const previousDefaultWorkspaceRoot = process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
  const defaultWorkspaceRoot = await tempRoot();
  const explicitRoot = await tempRoot();
  try {
    process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = defaultWorkspaceRoot;
    const result = await writeRoutedRuntimeEvent({
      source: 'service',
      category: 'transport',
      level: 'warn',
      event: 'service.explicit.runtimeEventsRoot',
    }, { runtimeEventsRoot: explicitRoot });

    assert.equal(result.ok, true);
    assert.equal(result.record.scope, 'system');
    assert.match(result.file, new RegExp(`${explicitRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/system/service/transport\\.jsonl$`));
  } finally {
    if (previousDefaultWorkspaceRoot === undefined) delete process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
    else process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = previousDefaultWorkspaceRoot;
  }
});

test('routed runtime events do not infer session from partial session context', async () => {
  const workspaceRoot = await tempRoot();
  const result = await writeRoutedRuntimeEvent({
    source: 'service',
    category: 'transport',
    level: 'warn',
    event: 'service.routed.partialSession',
    sessionId: 'session-only',
    dialogProcessId: 'dialog-1',
    workspaceRoot,
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.scope, 'system');
  assert.equal(result.record.sessionId, undefined);
  assert.equal(result.record.dialogProcessId, undefined);
  assert.match(result.file, /runtime\/events\/system\/service\/transport\.jsonl$/);
});

test('createRuntimeEventWriter merges default context', async () => {
  const workspaceRoot = await tempRoot();
  const writer = createRuntimeEventWriter({ source: 'service', workspaceRoot, userId: 'admin' });
  const result = await writer.system({
    category: 'config',
    level: 'info',
    event: 'service.config.loaded',
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.source, 'service');
  assert.equal(result.record.userId, 'admin');
  assert.match(result.file, /admin\/runtime\/events\/system\/service\/config\.jsonl$/);
});

test('createRuntimeEventWriter exposes routed writer with merged defaults', async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, 'admin', 'session-2');
  const writer = createRuntimeEventWriter({ source: 'agent', workspaceRoot, userId: 'admin', sessionId: 'session-2' });
  const result = await writer.routed({
    category: 'system',
    level: 'info',
    event: 'agent.routed.defaultSession',
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.scope, 'session');
  assert.equal(result.record.sessionId, 'session-2');
  assert.match(result.file, /admin\/runtime\/session\/session-2\/events\/system\.jsonl$/);
});

test('runtime event jsonl transport appends without rotating below max file bytes', async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, 'admin', 'rotation-1');
  const first = await writeRuntimeEvent({
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'info',
    event: 'agent.runtime.rotation.first',
    userId: 'admin',
    sessionId: 'rotation-1',
    workspaceRoot,
    data: { message: 'small' },
  }, { maxFileBytes: 1024 * 1024 });
  const second = await writeRuntimeEvent({
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'info',
    event: 'agent.runtime.rotation.second',
    userId: 'admin',
    sessionId: 'rotation-1',
    workspaceRoot,
    data: { message: 'small' },
  }, { maxFileBytes: 1024 * 1024 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.rotatedFile, null);
  const records = await readJsonl(second.file);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.event), [
    'agent.runtime.rotation.first',
    'agent.runtime.rotation.second',
  ]);
});
