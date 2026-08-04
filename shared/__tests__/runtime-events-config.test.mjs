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
  RUNTIME_EVENTS_EXECUTION_LOG_EVENT_CONTROLS,
  RUNTIME_EVENTS_SESSION_LOG_CONTROL_KEYS,
  RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES,
  isHookRuntimeEventVerboseEnabled,
  resolveHookRuntimeEventsMode,
  resolveRuntimeEventsMaxArchives,
  resolveRuntimeEventsMaxFileBytes,
  resolveRuntimeEventsExecutionLogControls,
  resolveRuntimeEventsRetentionDays,
  resolveRuntimeEventsSessionLogControls,
  resolveRuntimeEventsStorageConfig,
  shouldRecordRuntimeExecutionLog,
} from '../runtime-events-config.mjs';

test('session log registries reference controls with defaults and environment keys', () => {
  for (const controlKey of Object.values(RUNTIME_EVENTS_SESSION_LOG_CONTROL_KEYS)) {
    assert.equal(
      typeof RUNTIME_EVENTS_CONFIG_DEFAULTS.sessionLogControls.log[controlKey],
      'boolean',
      `${controlKey} should have a boolean default`,
    );
    assert.equal(
      typeof RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.log[controlKey],
      'string',
      `${controlKey} should have an environment key`,
    );
  }
  for (const [debugType, descriptor] of Object.entries(RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES)) {
    assert.equal(typeof descriptor.exposeToClient, 'boolean', `${debugType} should declare client exposure`);
    assert.equal(typeof RUNTIME_EVENTS_CONFIG_DEFAULTS.sessionLogControls.debug[descriptor.controlKey], 'boolean');
    assert.equal(typeof RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug[descriptor.controlKey], 'string');
  }
});

test('runtime-events storage config uses shared defaults', () => {
  assert.deepEqual(resolveRuntimeEventsStorageConfig({}), RUNTIME_EVENTS_CONFIG_DEFAULTS.runtimeEvents);
});

test('execution log controls are centralized and suppress full successful turn diagnostics by default', () => {
  for (const controlKey of Object.values(RUNTIME_EVENTS_EXECUTION_LOG_EVENT_CONTROLS)) {
    assert.equal(typeof RUNTIME_EVENTS_CONFIG_DEFAULTS.executionLogControls[controlKey], 'boolean');
    assert.equal(typeof RUNTIME_EVENTS_CONFIG_ENVS.executionLogControls[controlKey], 'string');
  }

  assert.equal(shouldRecordRuntimeExecutionLog({ event: 'session_turn_full' }, { env: {} }), false);
  assert.equal(shouldRecordRuntimeExecutionLog({ event: 'assistant_message_saved' }, { env: {} }), false);
  assert.equal(shouldRecordRuntimeExecutionLog({ event: 'tool_message_saved' }, { env: {} }), false);
  assert.equal(
    shouldRecordRuntimeExecutionLog(
      { event: 'session_turn_full', category: 'error', data: { error: 'save failed' } },
      { env: {} },
    ),
    true,
  );
  assert.equal(shouldRecordRuntimeExecutionLog({ event: 'workflow_failed' }, { env: {} }), true);
  assert.equal(
    shouldRecordRuntimeExecutionLog(
      { event: 'session_turn_full' },
      { env: { [RUNTIME_EVENTS_CONFIG_ENVS.executionLogControls.sessionTurnFullDebug]: 'on' } },
    ),
    true,
  );
  assert.deepEqual(resolveRuntimeEventsExecutionLogControls({}), {
    sessionTurnFullDebug: false,
    messagePersistenceSuccessDebug: false,
  });
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

test('session log controls honor explicit environment values independently of defaults', () => {
  for (const domain of ['log', 'debug']) {
    for (const [controlKey, envName] of Object.entries(
      RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls[domain],
    )) {
      assert.equal(
        resolveRuntimeEventsSessionLogControls({ [envName]: 'off' })[domain][controlKey],
        false,
        `${domain}.${controlKey} should resolve an explicit off value`,
      );
      assert.equal(
        resolveRuntimeEventsSessionLogControls({ [envName]: 'on' })[domain][controlKey],
        true,
        `${domain}.${controlKey} should resolve an explicit on value`,
      );
    }
  }
});

test('context identity diagnostics default on while other diagnostics retain their defaults', () => {
  const defaults = resolveRuntimeEventsSessionLogControls({});
  assert.equal(defaults.debug.contextIdentity, true);
  assert.equal(defaults.debug.agentContext, true);
  assert.equal(defaults.debug.agentTransport, true);
  assert.equal(defaults.debug.resend, false);
  assert.equal(defaults.debug.stop, false);

  const disabled = resolveRuntimeEventsSessionLogControls({
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug.contextIdentity]: 'false',
  });
  assert.equal(disabled.debug.contextIdentity, false);

  const agentContextDisabled = resolveRuntimeEventsSessionLogControls({
    [RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug.agentContext]: 'false',
  });
  assert.equal(agentContextDisabled.debug.agentContext, false);
});

test('agent transport diagnostics are independently configurable and default on', () => {
  const envName = RUNTIME_EVENTS_CONFIG_ENVS.sessionLogControls.debug.agentTransport;
  assert.equal(envName, 'NOOBOT_RUNTIME_EVENT_AGENT_TRANSPORT_DEBUG');
  assert.deepEqual(RUNTIME_EVENTS_SESSION_LOG_DEBUG_TYPES['agent-transport'], {
    controlKey: 'agentTransport',
    exposeToClient: true,
  });
  assert.equal(resolveRuntimeEventsSessionLogControls({}).debug.agentTransport, true);
  assert.equal(resolveRuntimeEventsSessionLogControls({ [envName]: 'off' }).debug.agentTransport, false);
});

test('session log controls do not accept the removed flat override protocol', () => {
  const controls = resolveRuntimeEventsSessionLogControls({}, {
    messageLog: false,
    contextIdentityDebug: false,
  });
  assert.equal(controls.log.message, true);
  assert.equal(controls.debug.contextIdentity, true);
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
