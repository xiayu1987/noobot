import { DEFAULT_WORKSPACE_ROOT, RUNTIME_EVENTS_DIR } from './constants.js';

export const DEFAULT_RUNTIME_EVENTS_ROOT_ENV = 'NOOBOT_RUNTIME_EVENTS_ROOT';
export const DEFAULT_RUNTIME_EVENTS_WORKSPACE_ROOT_ENV = 'NOOBOT_RUNTIME_EVENTS_WORKSPACE_ROOT';

export function resolveDefaultRuntimeEventsConfig(env = process.env) {
  return {
    workspaceRoot:
      env[DEFAULT_RUNTIME_EVENTS_WORKSPACE_ROOT_ENV] ||
      env[DEFAULT_RUNTIME_EVENTS_ROOT_ENV] ||
      env.NOOBOT_WORKSPACE_ROOT ||
      DEFAULT_WORKSPACE_ROOT,
    dirName: RUNTIME_EVENTS_DIR,
  };
}
