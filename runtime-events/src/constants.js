/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const RUNTIME_EVENT_SCOPES = Object.freeze({ STARTUP: 'startup', SESSION: 'session', SYSTEM: 'system' });
export const RUNTIME_EVENT_LEVELS = Object.freeze({ DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error', FATAL: 'fatal' });
export const RUNTIME_EVENT_CATEGORIES = Object.freeze({ SYSTEM: 'system', STATE: 'state', MESSAGE: 'message', INTERACTION: 'interaction', TRANSPORT: 'transport', DEBUG: 'debug', SECURITY: 'security', CONFIG: 'config' });
export const RUNTIME_EVENT_CHANNELS = Object.freeze({ DIRECT: 'direct', PROCESS: 'process', STARTUP: 'startup', WEB_SOCKET: 'ws', AGENT_PROXY_WEB_SOCKET: 'agent-proxy-ws' });
export const DEFAULT_WORKSPACE_ROOT = '/workspace';
export const RUNTIME_EVENTS_DIR = 'events';
