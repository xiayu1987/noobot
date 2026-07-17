/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RUNTIME_EVENTS_CONFIG_ENVS } from '@noobot/shared/runtime-events-config';

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
import { resolveWorkspaceSessionPaths } from '../src/session-deletion-guard.js';
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

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'runtime-events-'));
}

async function readJsonl(file) {
  const text = await fs.readFile(file, 'utf8');
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function markSessionDeleted(workspaceRoot, userId, sessionId) {
  const paths = resolveWorkspaceSessionPaths({ workspaceRoot, userId, sessionId });
  await fs.mkdir(path.dirname(paths.markerFile), { recursive: true });
  await fs.writeFile(paths.markerFile, JSON.stringify({
    sessions: { [sessionId]: { deletedAt: new Date().toISOString() } },
  }), 'utf8');
  return paths;
}

async function writeArchive(file, ageMs = 0) {
  await fs.writeFile(file, `${JSON.stringify({ archived: path.basename(file) })}\n`, 'utf8');
  const time = new Date(Date.now() - ageMs);
  await fs.utimes(file, time, time);
  return file;
}

test('session log protocol exports stable categories and helpers from runtime-events', () => {
  assert.ok(SESSION_LOG_CATEGORIES.includes('system'));
  assert.ok(SESSION_LOG_CATEGORIES.includes(SESSION_LOG_DEBUG_CATEGORY));
  assert.ok(SESSION_LOG_RECORD_FIELDS.includes('sessionId'));
  assert.equal(normalizeSessionLogCategory('missing'), SESSION_LOG_DEFAULT_CATEGORY);
  assert.equal(normalizeSessionLogCategory('DEBUG'), SESSION_LOG_DEBUG_CATEGORY);
  assert.equal(getSessionLogControlKey({ category: 'message' }, 'message'), 'messageLog');
  assert.equal(getSessionLogDebugControlKey({ data: { debugType: 'state-machine' } }), 'stateMachineDebug');
  assert.equal(getSessionLogDebugControlKey({ debugType: 'stop-continue' }), 'frontendStopContinueDebug');
  assert.equal(getSessionLogDebugControlKey({ data: { debugType: 'stop-continue' } }), 'frontendStopContinueDebug');
  assert.equal(getSessionLogDebugControlKey({ data: { debugType: 'agent-proxy-route' } }), 'agentProxyRouteDebug');

  const record = buildSessionLogRecord({
    source: 'frontend',
    category: 'message',
    event: 'chat.message',
    sessionId: 'session-1',
    message: 'hello',
    data: { turnScopeId: 'turn-1' },
  }, { includeTimestamp: false });

  assert.deepEqual(record, {
    source: 'frontend',
    category: 'message',
    level: 'info',
    event: 'chat.message',
    sessionId: 'session-1',
    dialogProcessId: '',
    turnScopeId: 'turn-1',
    message: 'hello',
    data: { turnScopeId: 'turn-1' },
  });
});

test('session log record preserves top-level debug type in data', () => {
  const record = buildSessionLogRecord({
    source: 'frontend',
    category: 'debug',
    level: 'debug',
    debugType: 'stop-continue',
    event: 'frontend.stopContinue.stopButtonEvaluated',
    sessionId: 'session-1',
    data: { changed: true },
  }, { includeTimestamp: false });

  assert.equal(record.data.debugType, 'stop-continue');
  assert.equal(getSessionLogDebugControlKey(record), 'frontendStopContinueDebug');
});

test('normalizeRuntimeEvent builds a sanitized structured record', () => {
  const record = normalizeRuntimeEvent({
    source: 'service',
    scope: 'system',
    category: 'security',
    level: 'warn',
    event: 'service.auth.failed',
    data: { token: 'secret', reason: 'bad-token' },
    error: new Error('boom'),
  }, { includeProcess: false });

  assert.equal(record.version, 1);
  assert.equal(record.source, 'service');
  assert.equal(record.scope, 'system');
  assert.equal(record.data.token, '[Redacted]');
  assert.equal(record.data.reason, 'bad-token');
  assert.equal(record.error.name, 'Error');
});

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

test('runtime event jsonl transport rotates active file when max file bytes is exceeded', async () => {
  const workspaceRoot = await tempRoot();
  const baseEvent = {
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'info',
    userId: 'admin',
    sessionId: 'rotation-2',
    workspaceRoot,
  };
  const first = await writeRuntimeEvent({
    ...baseEvent,
    event: 'agent.runtime.rotation.archiveSource',
    data: { message: 'x'.repeat(160) },
  }, { maxFileBytes: 1 });
  const second = await writeRuntimeEvent({
    ...baseEvent,
    event: 'agent.runtime.rotation.activeAfterArchive',
    data: { message: 'y'.repeat(160) },
  }, { maxFileBytes: 1 });

  assert.equal(first.ok, true);
  assert.equal(first.rotatedFile, null);
  assert.equal(second.ok, true);
  assert.match(second.rotatedFile, /system\.\d{8}T\d{6}Z\.jsonl$/);
  const archivedRecords = await readJsonl(second.rotatedFile);
  const activeRecords = await readJsonl(second.file);
  assert.equal(archivedRecords.length, 1);
  assert.equal(archivedRecords[0].event, 'agent.runtime.rotation.archiveSource');
  assert.equal(activeRecords.length, 1);
  assert.equal(activeRecords[0].event, 'agent.runtime.rotation.activeAfterArchive');
});

test('runtime event max file bytes can be disabled with zero', async () => {
  const workspaceRoot = await tempRoot();
  const baseEvent = {
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'info',
    userId: 'admin',
    sessionId: 'rotation-disabled',
    workspaceRoot,
  };
  const first = await writeRuntimeEvent({
    ...baseEvent,
    event: 'agent.runtime.rotation.disabledFirst',
    data: { message: 'x'.repeat(160) },
  }, { maxFileBytes: 0 });
  const second = await writeRuntimeEvent({
    ...baseEvent,
    event: 'agent.runtime.rotation.disabledSecond',
    data: { message: 'y'.repeat(160) },
  }, { maxFileBytes: 0 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.rotatedFile, null);
  assert.equal((await readJsonl(second.file)).length, 2);
});

test('runtime event max file bytes falls back when environment value is invalid', async () => {
  const maxFileBytesEnv = RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxFileBytes;
  const previousMaxFileBytes = process.env[maxFileBytesEnv];
  const previousDefaultWorkspaceRoot = process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
  const defaultWorkspaceRoot = await tempRoot();
  try {
    process.env[maxFileBytesEnv] = 'invalid';
    process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = defaultWorkspaceRoot;
    const first = await writeRoutedRuntimeEvent({
      source: 'agent',
      category: 'system',
      level: 'info',
      event: 'agent.runtime.rotation.invalidEnvFirst',
      userId: 'admin',
      sessionId: 'rotation-invalid-env',
      data: { message: 'x'.repeat(160) },
    });
    const second = await writeRoutedRuntimeEvent({
      source: 'agent',
      category: 'system',
      level: 'info',
      event: 'agent.runtime.rotation.invalidEnvSecond',
      userId: 'admin',
      sessionId: 'rotation-invalid-env',
      data: { message: 'y'.repeat(160) },
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.rotatedFile, null);
    assert.equal((await readJsonl(second.file)).length, 2);
  } finally {
    if (previousMaxFileBytes === undefined) delete process.env[maxFileBytesEnv];
    else process.env[maxFileBytesEnv] = previousMaxFileBytes;
    if (previousDefaultWorkspaceRoot === undefined) delete process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
    else process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT = previousDefaultWorkspaceRoot;
  }
});

test('runtime event archive cleanup deletes archives older than retention days', async () => {
  const workspaceRoot = await tempRoot();
  const baseEvent = {
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'info',
    userId: 'admin',
    sessionId: 'cleanup-ttl',
    workspaceRoot,
  };
  const seed = await writeRuntimeEvent({ ...baseEvent, event: 'agent.runtime.cleanup.seed' }, {
    maxFileBytes: 0,
    retentionDays: 0,
    maxArchives: 0,
  });
  const oldArchive = path.join(path.dirname(seed.file), 'system.20000101T000000Z.jsonl');
  const freshArchive = path.join(path.dirname(seed.file), 'system.29990101T000000Z.jsonl');
  await writeArchive(oldArchive, 2 * 24 * 60 * 60 * 1000);
  await writeArchive(freshArchive, 0);

  const result = await writeRuntimeEvent({ ...baseEvent, event: 'agent.runtime.cleanup.ttl' }, {
    maxFileBytes: 0,
    retentionDays: 1,
    maxArchives: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(await pathExists(oldArchive), false);
  assert.equal(await pathExists(freshArchive), true);
  assert.equal(await pathExists(result.file), true);
  assert.deepEqual(result.deletedFiles, [oldArchive]);
});

test('runtime event archive cleanup keeps only newest max archives', async () => {
  const workspaceRoot = await tempRoot();
  const baseEvent = {
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'info',
    userId: 'admin',
    sessionId: 'cleanup-max',
    workspaceRoot,
  };
  const seed = await writeRuntimeEvent({ ...baseEvent, event: 'agent.runtime.cleanup.maxSeed' }, {
    maxFileBytes: 0,
    retentionDays: 0,
    maxArchives: 0,
  });
  const dir = path.dirname(seed.file);
  const first = await writeArchive(path.join(dir, 'system.20000101T000000Z.jsonl'), 3000);
  const second = await writeArchive(path.join(dir, 'system.20000101T000001Z.jsonl'), 2000);
  const third = await writeArchive(path.join(dir, 'system.20000101T000002Z.jsonl'), 1000);

  const result = await writeRuntimeEvent({ ...baseEvent, event: 'agent.runtime.cleanup.max' }, {
    maxFileBytes: 0,
    retentionDays: 0,
    maxArchives: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(await pathExists(first), false);
  assert.equal(await pathExists(second), true);
  assert.equal(await pathExists(third), true);
  assert.equal(await pathExists(result.file), true);
  assert.deepEqual(result.deletedFiles, [first]);
});

test('runtime event archive cleanup can be disabled', async () => {
  const workspaceRoot = await tempRoot();
  const baseEvent = {
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'info',
    userId: 'admin',
    sessionId: 'cleanup-disabled',
    workspaceRoot,
  };
  const seed = await writeRuntimeEvent({ ...baseEvent, event: 'agent.runtime.cleanup.disabledSeed' }, {
    maxFileBytes: 0,
    retentionDays: 0,
    maxArchives: 0,
  });
  const archive = await writeArchive(path.join(path.dirname(seed.file), 'system.20000101T000000Z.jsonl'), 30 * 24 * 60 * 60 * 1000);

  const result = await writeRuntimeEvent({ ...baseEvent, event: 'agent.runtime.cleanup.disabled' }, {
    maxFileBytes: 0,
    retentionDays: 0,
    maxArchives: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(await pathExists(archive), true);
  assert.deepEqual(result.deletedFiles, []);
});

test('runtime event archive cleanup ignores active and unrelated jsonl files', async () => {
  const workspaceRoot = await tempRoot();
  const baseEvent = {
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'info',
    userId: 'admin',
    sessionId: 'cleanup-active',
    workspaceRoot,
  };
  const seed = await writeRuntimeEvent({ ...baseEvent, event: 'agent.runtime.cleanup.activeSeed' }, {
    maxFileBytes: 0,
    retentionDays: 0,
    maxArchives: 0,
  });
  const unrelated = await writeArchive(path.join(path.dirname(seed.file), 'interaction.20000101T000000Z.jsonl'), 30 * 24 * 60 * 60 * 1000);

  const result = await writeRuntimeEvent({ ...baseEvent, event: 'agent.runtime.cleanup.active' }, {
    maxFileBytes: 0,
    retentionDays: 1,
    maxArchives: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(await pathExists(result.file), true);
  assert.equal(await pathExists(unrelated), true);
  assert.equal((await readJsonl(result.file)).length, 2);
});

test('existing session-channel API remains available', async () => {
  const root = await tempRoot();
  const result = await writeSessionChannelEvent({
    source: 'agent',
    channel: SESSION_CHANNELS.DIRECT,
    category: 'system',
    event: 'agent.compat.sessionChannel',
    userId: 'admin',
    sessionId: 'session-1',
  }, { root, dirName: 'events' });

  assert.equal(result.ok, true);
  assert.match(result.file, /session-1\/system\.jsonl$/);
});

test('session-channel does not recreate a deleted session directory', async () => {
  const workspaceRoot = await tempRoot();
  const userId = 'admin';
  const sessionId = 'deleted-channel-session';
  const { sessionDir } = await markSessionDeleted(workspaceRoot, userId, sessionId);
  const result = await writeSessionChannelEvent({
    source: 'agent', category: 'system', event: 'late.log', userId, sessionId,
  }, { workspaceRoot, dirName: 'logs' });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.deleted, true);
  assert.equal(await pathExists(sessionDir), false);
});

test('runtime event writer does not recreate a deleted session directory', async () => {
  const workspaceRoot = await tempRoot();
  const userId = 'admin';
  const sessionId = 'deleted-runtime-session';
  const { sessionDir } = await markSessionDeleted(workspaceRoot, userId, sessionId);
  const result = await writeRuntimeEvent({
    source: 'frontend', scope: 'session', category: 'message', event: 'late.event',
    userId, sessionId, workspaceRoot,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.deleted, true);
  assert.equal(await pathExists(sessionDir), false);
});

test('runtime-events writer records normal session logs by default', async () => {
  const root = await tempRoot();
  const result = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'message',
    level: 'info',
    event: 'chat.message',
    userId: 'admin',
    sessionId: 'session-log-default',
  }, { root, includeProcess: false });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.equal((await readJsonl(result.file)).length, 1);
});

test('runtime-events writer drops debug session logs by default', async () => {
  const root = await tempRoot();
  const result = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'state.transition',
    userId: 'admin',
    sessionId: 'session-debug-default',
    data: { debugType: 'state-machine' },
  }, { root, includeProcess: false });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test('runtime-events writer filters session logs by business log control', async () => {
  const root = await tempRoot();
  const skipped = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'message',
    level: 'info',
    event: 'chat.message',
    userId: 'admin',
    sessionId: 'session-category-filter',
  }, { root, includeProcess: false, messageLog: false });
  const recorded = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'state',
    level: 'info',
    event: 'state.update',
    userId: 'admin',
    sessionId: 'session-category-filter',
  }, { root, includeProcess: false, stateLog: true, messageLog: false });

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(recorded.ok, true);
  assert.equal((await readJsonl(recorded.file)).length, 1);
});

test('runtime-events writer separates debug session logs by debug type', async () => {
  const root = await tempRoot();
  const stateMachine = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'state.transition',
    userId: 'admin',
    sessionId: 'session-debug-files',
    data: { debugType: 'state-machine' },
  }, { root, includeProcess: false, stateMachineDebug: true, resendDebug: true });
  const resend = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'resend.tick',
    userId: 'admin',
    sessionId: 'session-debug-files',
    data: { debugType: 'resend' },
  }, { root, includeProcess: false, stateMachineDebug: true, resendDebug: true });

  assert.equal(stateMachine.ok, true);
  assert.equal(resend.ok, true);
  assert.match(stateMachine.file, /session-debug-files\/debug-state-machine\.jsonl$/);
  assert.match(resend.file, /session-debug-files\/debug-resend\.jsonl$/);
  assert.notEqual(stateMachine.file, resend.file);
  assert.equal((await readJsonl(stateMachine.file))[0].category, 'debug');
  assert.equal((await readJsonl(resend.file))[0].category, 'debug');
});

test('runtime-events writer filters debug session logs by business debug control', async () => {
  const root = await tempRoot();
  const skipped = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'resend.tick',
    userId: 'admin',
    sessionId: 'session-debug-type',
    data: { debugType: 'resend' },
  }, { root, includeProcess: false, resendDebug: false });
  const recorded = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'state.transition',
    userId: 'admin',
    sessionId: 'session-debug-type',
    data: { debugType: 'state-machine' },
  }, { root, includeProcess: false, stateMachineDebug: true });

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(recorded.ok, true);
  assert.match(recorded.file, /session-debug-type\/debug-state-machine\.jsonl$/);
  assert.equal((await readJsonl(recorded.file)).length, 1);
});

test('runtime-events writer drops unknown debug session logs by default', async () => {
  const root = await tempRoot();
  const result = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'unknown.trace',
    userId: 'admin',
    sessionId: 'session-debug-unknown',
    data: { debugType: 'unknown-debug' },
  }, { root, includeProcess: false });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});
