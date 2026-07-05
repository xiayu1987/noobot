# @noobot/runtime-events

Noobot runtime event center for backend startup, session runtime, and system runtime events.

This package is a Node.js library. New code should use `@noobot/runtime-events`; existing session-channel APIs remain available at `@noobot/runtime-events/session-channel`.

## Scopes

- `startup`: process/config/listen/bootstrap events. Does not require session context.
- `session`: events that clearly belong to a session. Requires `userId` and `sessionId`.
- `system`: runtime events not tied to one session. Does not require session context.

## API

```js
import { writeRuntimeEvent, createRuntimeEventWriter } from '@noobot/runtime-events';

await writeRuntimeEvent({
  source: 'service',
  scope: 'system',
  category: 'transport',
  level: 'warn',
  event: 'service.runtime.pendingInteraction.rejected',
  workspaceRoot: '/workspace',
  data: { reason: 'client_disconnected' },
});

const events = createRuntimeEventWriter({ source: 'agent', workspaceRoot: '/workspace' });
await events.session({
  category: 'system',
  level: 'error',
  event: 'agent.doc2data.failed',
  userId: 'admin',
  sessionId: 'session-id',
});
```

## Storage

The default JSONL transport writes new runtime events under `runtime/events` for startup/system scopes and `runtime/session/{sessionId}/events` for session scope. The legacy session-channel entry keeps its existing storage behavior for compatibility inside this package.

## Rules

Do not fabricate session context. Do not route runtime-events internal write failures back into runtime-events recursively. Sanitize sensitive fields before storing structured data.
