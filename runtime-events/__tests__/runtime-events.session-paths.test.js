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

test('workspace runtime events store child session logs under the parent session', async () => {
  const workspaceRoot = await tempRoot();
  const result = await writeRuntimeEvent({
    source: 'agent', scope: 'session', category: 'system', event: 'child.event',
    userId: 'admin', sessionId: 'child-session', parentSessionId: 'parent-session', workspaceRoot,
  }, { includeProcess: false });

  assert.equal(result.ok, true);
  assert.equal(result.record.sessionId, 'child-session');
  assert.equal(result.record.parentSessionId, 'parent-session');
  assert.match(result.file, /parent-session\/events\/system\.jsonl$/);
  assert.equal(await pathExists(path.join(workspaceRoot, 'admin', 'runtime', 'session', 'child-session')), false);
});

test('workspace session-channel stores child logs under the parent session', async () => {
  const workspaceRoot = await tempRoot();
  const result = await writeSessionChannelEvent({
    source: 'agent-proxy', category: 'transport', event: 'child.transport',
    userId: 'admin', sessionId: 'child-session', parentSessionId: 'parent-session',
  }, { workspaceRoot, dirName: 'logs' });

  assert.equal(result.ok, true);
  assert.match(result.file, /parent-session\/logs\/transport\.jsonl$/);
  assert.equal(await pathExists(path.join(workspaceRoot, 'admin', 'runtime', 'session', 'child-session')), false);
  const [record] = await readJsonl(result.file);
  assert.equal(record.sessionId, 'child-session');
  assert.equal(record.parentSessionId, 'parent-session');
});

test('workspace runtime events ignore placeholder parent session ids', async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, 'admin', 'real-session');
  const result = await writeRuntimeEvent({
    source: 'agent-proxy', scope: 'session', category: 'transport', event: 'root.transport',
    userId: 'admin', sessionId: 'real-session', parentSessionId: 'undefined', workspaceRoot,
    data: { parentSessionId: 'NULL' },
  }, { includeProcess: false });

  assert.equal(result.ok, true);
  assert.equal(result.record.parentSessionId, undefined);
  assert.equal(result.record.data.parentSessionId, undefined);
  assert.match(result.file, /real-session\/events\/transport\.jsonl$/);
  assert.equal(await pathExists(path.join(workspaceRoot, 'admin', 'runtime', 'session', 'undefined')), false);
});

test('workspace session-channel ignores placeholder parent session ids', async () => {
  const workspaceRoot = await tempRoot();
  await persistSession(workspaceRoot, 'admin', 'real-session');
  const result = await writeSessionChannelEvent({
    source: 'agent-proxy', category: 'transport', event: 'root.transport',
    userId: 'admin', sessionId: 'real-session', parentSessionId: 'undefined',
    data: { parentSessionId: 'null' },
  }, { workspaceRoot, dirName: 'logs' });

  assert.equal(result.ok, true);
  assert.match(result.file, /real-session\/logs\/transport\.jsonl$/);
  const [record] = await readJsonl(result.file);
  assert.equal(record.parentSessionId, undefined);
  assert.equal(record.data.parentSessionId, undefined);
  assert.equal(await pathExists(path.join(workspaceRoot, 'admin', 'runtime', 'session', 'undefined')), false);
});

test('placeholder parent session id cannot create an unpersisted session directory', async () => {
  const workspaceRoot = await tempRoot();
  const result = await writeSessionChannelEvent({
    source: 'agent-proxy', category: 'transport', event: 'draft.transport',
    userId: 'admin', sessionId: 'draft-session', parentSessionId: 'undefined',
  }, { workspaceRoot, dirName: 'logs' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.missingSession, true);
  assert.equal(await pathExists(path.join(workspaceRoot, 'admin', 'runtime', 'session', 'undefined')), false);
  assert.equal(await pathExists(path.join(workspaceRoot, 'admin', 'runtime', 'session', 'draft-session')), false);
});

test('workspace runtime events do not create an unpersisted session directory', async () => {
  const workspaceRoot = await tempRoot();
  const sessionDir = path.join(workspaceRoot, 'admin', 'runtime', 'session', 'draft-session');
  const result = await writeRuntimeEvent({
    source: 'frontend', scope: 'session', category: 'debug', level: 'debug',
    event: 'frontend.workflowRender.draft', userId: 'admin', sessionId: 'draft-session',
    workspaceRoot, data: { debugType: 'workflow-diagnostics' },
  }, { includeProcess: false, workflowDiagnosticsDebug: true });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.missingSession, true);
  assert.equal(await pathExists(sessionDir), false);
});

test('workspace session-channel does not create an unpersisted session directory', async () => {
  const workspaceRoot = await tempRoot();
  const sessionDir = path.join(workspaceRoot, 'admin', 'runtime', 'session', 'draft-session');
  const result = await writeSessionChannelEvent({
    source: 'frontend', category: 'message', event: 'draft.message',
    userId: 'admin', sessionId: 'draft-session',
  }, { workspaceRoot, dirName: 'logs' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.missingSession, true);
  assert.equal(await pathExists(sessionDir), false);
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

test('runtime event writer does not recreate a deleted parent session for child logs', async () => {
  const workspaceRoot = await tempRoot();
  const userId = 'admin';
  const parentSessionId = 'deleted-parent-session';
  const { sessionDir } = await markSessionDeleted(workspaceRoot, userId, parentSessionId);
  const result = await writeRuntimeEvent({
    source: 'agent', scope: 'session', category: 'system', event: 'late.child.event',
    userId, sessionId: 'child-session', parentSessionId, workspaceRoot,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.deleted, true);
  assert.equal(await pathExists(sessionDir), false);
});

test('runtime-events writer records normal session logs when their control is enabled', async () => {
  const root = await tempRoot();
  const result = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'message',
    level: 'info',
    event: 'chat.message',
    userId: 'admin',
    sessionId: 'session-log-default',
  }, { root, includeProcess: false, messageLog: true });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.equal((await readJsonl(result.file)).length, 1);
});
