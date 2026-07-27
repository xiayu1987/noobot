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

test('runtime event jsonl transport rotates active file when max file bytes is exceeded', async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, 'admin', 'rotation-2');
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
  await persistSession(workspaceRoot, 'admin', 'rotation-disabled');
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

test('runtime event jsonl transport serializes concurrent writes to the same file', async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, 'admin', 'concurrent-writes');
  const writes = await Promise.all(Array.from({ length: 100 }, (_, id) => writeRuntimeEvent({
    source: 'agent',
    scope: 'session',
    category: 'system',
    level: 'info',
    event: 'agent.runtime.concurrentWrite',
    userId: 'admin',
    sessionId: 'concurrent-writes',
    workspaceRoot,
    data: { id },
  })));
  assert.equal(writes.every((result) => result.ok), true);
  const records = await readJsonl(writes[0].file);
  assert.equal(records.length, 100);
  assert.deepEqual(new Set(records.map((record) => record.data.id)).size, 100);
});

test('runtime event max file bytes falls back when environment value is invalid', async () => {
  const maxFileBytesEnv = RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxFileBytes;
  const previousMaxFileBytes = process.env[maxFileBytesEnv];
  const previousDefaultWorkspaceRoot = process.env.NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT;
  const defaultWorkspaceRoot = await tempRoot();
  try {
    await persistSession(defaultWorkspaceRoot, 'admin', 'rotation-invalid-env');
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
  await persistSession(workspaceRoot, 'admin', 'cleanup-ttl');
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
    cleanupIntervalMs: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(await pathExists(oldArchive), false);
  assert.equal(await pathExists(freshArchive), true);
  assert.equal(await pathExists(result.file), true);
  assert.deepEqual(result.deletedFiles, [oldArchive]);
});

test('runtime event archive cleanup keeps only newest max archives', async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, 'admin', 'cleanup-max');
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
    cleanupIntervalMs: 0,
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
  await persistSession(workspaceRoot, 'admin', 'cleanup-disabled');
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
  await persistSession(workspaceRoot, 'admin', 'cleanup-active');
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
    cleanupIntervalMs: 0,
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
