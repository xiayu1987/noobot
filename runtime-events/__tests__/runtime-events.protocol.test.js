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
  RUNTIME_EVENTS_CONFIG_ENVS,
  RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES,
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
  resolveSessionLogClientPolicy,
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

test('session log protocol exports stable categories and helpers from runtime-events', () => {
  assert.ok(SESSION_LOG_CATEGORIES.includes('system'));
  assert.ok(SESSION_LOG_CATEGORIES.includes(SESSION_LOG_DEBUG_CATEGORY));
  assert.ok(SESSION_LOG_RECORD_FIELDS.includes('sessionId'));
  for (const category of [
    'frontend-lifecycle', 'agent-proxy-http', 'agent-proxy-websocket',
    'agent-proxy-route', 'backend-websocket', 'backend-lifecycle',
  ]) {
    assert.ok(SESSION_LOG_CATEGORIES.includes(category), `missing category: ${category}`);
    assert.equal(normalizeSessionLogCategory(category), category);
  }
  assert.equal(normalizeSessionLogCategory('missing'), SESSION_LOG_DEFAULT_CATEGORY);
  assert.equal(normalizeSessionLogCategory('DEBUG'), SESSION_LOG_DEBUG_CATEGORY);
  assert.equal(getSessionLogControlKey({ category: 'message' }, 'message'), 'messageLog');
  assert.equal(getSessionLogDebugControlKey({ data: { debugType: 'state-machine' } }), 'stateMachineDebug');
  assert.equal(getSessionLogDebugControlKey({ debugType: 'stop-continue' }), 'frontendStopContinueDebug');
  assert.equal(getSessionLogDebugControlKey({ data: { debugType: 'stop-continue' } }), 'frontendStopContinueDebug');
  assert.equal(getSessionLogDebugControlKey({ data: { debugType: 'terminal-resolution' } }), 'frontendTerminalResolutionDebug');
  assert.equal(getSessionLogDebugControlKey({ data: { debugType: 'tool-log-window' } }), 'frontendToolLogWindowDebug');
  assert.equal(getSessionLogDebugControlKey({ data: { debugType: 'timeline-pipeline' } }), 'timelinePipelineDebug');
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

test('session log client policy is derived from the shared debug registry', () => {
  const policy = resolveSessionLogClientPolicy({
    workflowDiagnosticsDebug: true,
    frontendToolLogWindowDebug: true,
    timelinePipelineDebug: true,
  });

  assert.equal(policy.debug['workflow-diagnostics'], true);
  assert.equal(policy.debug['tool-log-window'], true);
  assert.equal(policy.debug.resend, true);
  assert.equal(policy.debug.stop, true);
  assert.equal(Object.hasOwn(policy.debug, 'timeline-pipeline'), false);
  assert.deepEqual(
    Object.keys(policy.debug).sort(),
    Object.entries(RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES)
      .filter(([, descriptor]) => descriptor.exposeToClient === true)
      .map(([debugType]) => debugType)
      .sort(),
  );
  assert.equal(policy.limits.maxDebugQueue > 0, true);
  assert.equal(policy.limits.maxDebugBytes > 0, true);
  assert.equal(policy.limits.debugTtlMs > 0, true);
});

test('tool log window debug uses its own file when enabled', async () => {
  assert.equal(
    RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.frontendToolLogWindowDebug,
    'NOOBOT_RUNTIME_EVENT_FRONTEND_TOOL_LOG_WINDOW_DEBUG',
  );
  const root = await tempRoot();
  const result = await writeRuntimeEvent({
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'frontend.toolLogWindow.rendererReceived',
    userId: 'admin',
    sessionId: 'session-tool-window',
    data: { debugType: 'tool-log-window', selectedCount: 10 },
  }, { root, includeProcess: false, frontendToolLogWindowDebug: true });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.match(result.file, /session-tool-window\/debug-tool-log-window\.jsonl$/);
  assert.equal((await readJsonl(result.file))[0].data.selectedCount, 10);
});

test('workflow diagnostics debug follows explicit disabled and enabled controls', async () => {
  assert.equal(
    RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.workflowDiagnosticsDebug,
    'NOOBOT_RUNTIME_EVENT_WORKFLOW_DIAGNOSTICS_DEBUG',
  );
  const root = await tempRoot();
  const event = {
    source: 'frontend',
    scope: 'session',
    category: 'debug',
    level: 'debug',
    event: 'frontend.workflowRender.cardMounted',
    userId: 'admin',
    sessionId: 'session-workflow',
    data: { debugType: 'workflow-diagnostics', workflowRunId: 'workflow-1' },
  };
  const skipped = await writeRuntimeEvent(event, {
    root,
    includeProcess: false,
    workflowDiagnosticsDebug: false,
  });

  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);
  assert.equal(await pathExists(path.join(root, 'session-workflow', 'debug-workflow-diagnostics.jsonl')), false);

  const result = await writeRuntimeEvent(event, {
    root,
    includeProcess: false,
    workflowDiagnosticsDebug: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.match(result.file, /session-workflow\/debug-workflow-diagnostics\.jsonl$/);
  assert.equal((await readJsonl(result.file))[0].data.workflowRunId, 'workflow-1');
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
