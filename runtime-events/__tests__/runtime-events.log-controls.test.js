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
  }, { root, includeProcess: false, sessionLogControls: { debug: { stateMachine: false } } });

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
  }, { root, includeProcess: false, sessionLogControls: { log: { message: false } } });
  const recorded = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'state',
    level: 'info',
    event: 'state.update',
    userId: 'admin',
    sessionId: 'session-category-filter',
  }, { root, includeProcess: false, sessionLogControls: { log: { state: true, message: false } } });

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
  }, { root, includeProcess: false, sessionLogControls: { debug: { stateMachine: true, resend: true } } });
  const resend = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'resend.tick',
    userId: 'admin',
    sessionId: 'session-debug-files',
    data: { debugType: 'resend' },
  }, { root, includeProcess: false, sessionLogControls: { debug: { stateMachine: true, resend: true } } });

  assert.equal(stateMachine.ok, true);
  assert.equal(resend.ok, true);
  assert.match(stateMachine.file, /session-debug-files\/debug-state-machine\.jsonl$/);
  assert.match(resend.file, /session-debug-files\/debug-resend\.jsonl$/);
  assert.notEqual(stateMachine.file, resend.file);
  assert.equal((await readJsonl(stateMachine.file))[0].category, 'debug');
  assert.equal((await readJsonl(resend.file))[0].category, 'debug');
});

test('agent context debug logs default on and use their own file', async () => {
  const root = await tempRoot();
  const recorded = await writeRuntimeEvent({
    source: 'agent',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'agent.context.executionScopeCreated',
    userId: 'admin',
    sessionId: 'session-agent-context',
    data: { debugType: 'agent-context', envelope: { protocolVersion: 1 } },
  }, { root, includeProcess: false });

  assert.equal(recorded.ok, true);
  assert.equal(recorded.skipped, undefined);
  assert.match(recorded.file, /session-agent-context\/debug-agent-context\.jsonl$/);

  const disabled = await writeRuntimeEvent({
    source: 'agent',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'agent.context.executionScopeCreated',
    userId: 'admin',
    sessionId: 'session-agent-context-disabled',
    data: { debugType: 'agent-context' },
  }, {
    root,
    includeProcess: false,
    sessionLogControls: { debug: { agentContext: false } },
  });
  assert.equal(disabled.skipped, true);
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
  }, { root, includeProcess: false, sessionLogControls: { debug: { resend: false } } });
  const recorded = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'state.transition',
    userId: 'admin',
    sessionId: 'session-debug-type',
    data: { debugType: 'state-machine' },
  }, { root, includeProcess: false, sessionLogControls: { debug: { stateMachine: true } } });

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

test('runtime-events writer never suppresses an error with a disabled debug control', async () => {
  const root = await tempRoot();
  const result = await writeRuntimeEvent({
    source: 'agent',
    scope: 'session',
    category: 'debug',
    level: 'error',
    event: 'agent.contextIdentity.failed',
    userId: 'admin',
    sessionId: 'session-debug-error',
    data: { debugType: 'context-identity', reason: 'invalid identity' },
  }, {
    root,
    includeProcess: false,
    sessionLogControls: { debug: { contextIdentity: false } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.match(result.file, /session-debug-error\/debug-context-identity\.jsonl$/);
});

test('routed debug logs without session context still honor their debug control', async () => {
  const root = await tempRoot();
  const event = {
    source: 'frontend',
    category: 'debug',
    level: 'debug',
    event: 'frontend.toolLogWindow.executionWindowSelected',
    userId: 'admin',
    data: { debugType: 'tool-log-window', candidateCount: 100 },
  };

  const skipped = await writeRoutedRuntimeEvent(event, {
    root,
    includeProcess: false,
    sessionLogControls: { debug: { frontendToolLogWindow: false } },
  });

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.record.scope, 'system');
  assert.equal(await pathExists(path.join(root, 'system', 'frontend', 'debug.jsonl')), false);

  const recorded = await writeRoutedRuntimeEvent(event, {
    root,
    includeProcess: false,
    sessionLogControls: { debug: { frontendToolLogWindow: true } },
  });

  assert.equal(recorded.ok, true);
  assert.equal(recorded.skipped, undefined);
  assert.equal(recorded.record.scope, 'system');
  assert.match(recorded.file, /system\/frontend\/debug\.jsonl$/);
  assert.equal((await readJsonl(recorded.file))[0].data.candidateCount, 100);
});

test('non-debug system runtime events are not governed by session log controls', async () => {
  const root = await tempRoot();
  const result = await writeSystemRuntimeEvent({
    source: 'service',
    category: 'system',
    level: 'info',
    event: 'service.runtime.ready',
  }, { root, includeProcess: false, sessionLogControls: { log: { system: false } } });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.equal((await readJsonl(result.file))[0].event, 'service.runtime.ready');
});
