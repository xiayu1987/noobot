/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNTIME_EVENTS_CONFIG_DEFAULTS,
  RUNTIME_EVENTS_CONFIG_ENVS,
  isHookRuntimeEventVerboseEnabled,
  resolveHookRuntimeEventsMode,
  resolveRuntimeEventsMaxArchives,
  resolveRuntimeEventsMaxFileBytes,
  resolveRuntimeEventsRetentionDays,
  resolveRuntimeEventsSessionLogControls,
  resolveRuntimeEventsStorageConfig,
} from '../runtime-events-config.mjs';

test('runtime-events storage config uses shared defaults', () => {
  assert.deepEqual(resolveRuntimeEventsStorageConfig({}), RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents);
});

test('runtime-events storage config falls back on invalid values', () => {
  const env = {
    [RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxFileBytes]: 'invalid',
    [RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.retentionDays]: '-1',
    [RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxArchives]: 'NaN',
  };
  assert.equal(resolveRuntimeEventsMaxFileBytes(env), RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents.maxFileBytes);
  assert.equal(resolveRuntimeEventsRetentionDays(env), RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents.retentionDays);
  assert.equal(resolveRuntimeEventsMaxArchives(env), RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents.maxArchives);
});

test('runtime-events storage cleanup can be disabled with zero values', () => {
  const env = {
    [RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxFileBytes]: '0',
    [RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.retentionDays]: '0',
    [RUNTIME_EVENTS_CONFIG_ENVS.runtimeEvents.maxArchives]: '0',
  };
  assert.deepEqual(resolveRuntimeEventsStorageConfig(env), {
    maxFileBytes: 0,
    retentionDays: 0,
    maxArchives: 0,
  });
});

test('runtime-events session log controls use business defaults', () => {
  assert.deepEqual(
    resolveRuntimeEventsSessionLogControls({}),
    RUNTIME_EVENTS_CONFIG_DEFAULTS.sessionLogControls,
  );
  assert.equal(resolveRuntimeEventsSessionLogControls({}).messageLog, true);
  assert.equal(resolveRuntimeEventsSessionLogControls({}).stateMachineDebug, false);
  assert.equal(resolveRuntimeEventsSessionLogControls({}).frontendStopContinueDebug, false);
  assert.equal(resolveRuntimeEventsSessionLogControls({}).agentProxyRouteDebug, false);
});

test('runtime-events session log controls resolve per business env and overrides', () => {
  const env = {
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.messageLog]: 'off',
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.stateMachineDebug]: 'on',
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.resendDebug]: 'invalid',
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.frontendStopContinueDebug]: 'off',
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.agentProxyRouteDebug]: 'off',
  };

  const resolved = resolveRuntimeEventsSessionLogControls(env, { transportLog: false });
  assert.equal(resolved.messageLog, false);
  assert.equal(resolved.stateMachineDebug, true);
  assert.equal(resolved.resendDebug, false);
  assert.equal(resolved.frontendStopContinueDebug, false);
  assert.equal(resolved.agentProxyRouteDebug, false);
  assert.equal(resolved.transportLog, false);
});

test('runtime-events lifecycle controls can be disabled independently', () => {
  const env = {
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.frontendLifecycleLog]: 'off',
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.agentProxyHttpLog]: 'false',
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.agentProxyWebSocketLog]: '0',
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.agentProxyRouteLog]: 'no',
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.backendWebSocketLog]: 'disabled',
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.backendLifecycleLog]: 'invalid',
  };
  const resolved = resolveRuntimeEventsSessionLogControls(env);
  assert.equal(resolved.frontendLifecycleLog, false);
  assert.equal(resolved.agentProxyHttpLog, false);
  assert.equal(resolved.agentProxyWebSocketLog, false);
  assert.equal(resolved.agentProxyRouteLog, false);
  assert.equal(resolved.backendWebSocketLog, false);
  assert.equal(resolved.backendLifecycleLog, true);
});

test('hook runtime-events mode defaults to summary and recognizes verbose values', () => {
  assert.equal(resolveHookRuntimeEventsMode({ env: {} }), 'summary');
  assert.equal(isHookRuntimeEventVerboseEnabled({ env: {} }), false);
  for (const value of ['verbose', 'trace', 'debug', 'full', '1', 'true', 'on', 'yes']) {
    assert.equal(isHookRuntimeEventVerboseEnabled({ env: { [RUNTIME_EVENTS_CONFIG_ENVS.hookRuntimeEvents.mode]: value } }), true);
  }
});

test('hook runtime-events mode prefers runtime/options before environment', () => {
  assert.equal(isHookRuntimeEventVerboseEnabled({
    runtime: { systemRuntime: { hookRuntimeEventsMode: 'summary' } },
    env: { [RUNTIME_EVENTS_CONFIG_ENVS.hookRuntimeEvents.mode]: 'verbose' },
  }), false);
  assert.equal(isHookRuntimeEventVerboseEnabled({
    options: { hookRuntimeEventsMode: 'verbose' },
    env: { [RUNTIME_EVENTS_CONFIG_ENVS.hookRuntimeEvents.mode]: 'summary' },
  }), true);
});
