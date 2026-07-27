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

test('runtime-events writer drops debug session logs when their control is disabled', async () => {
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
  }, { root, includeProcess: false, stateMachineDebug: false });

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
