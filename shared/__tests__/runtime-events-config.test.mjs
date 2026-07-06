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
