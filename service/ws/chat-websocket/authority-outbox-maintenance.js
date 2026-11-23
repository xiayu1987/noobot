/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { readServiceClockMs } from "./service-clock.js";
import { recordServiceWebSocketRuntimeError } from "./runtime-events.js";

const maintenanceByRuntime = new WeakMap();

async function compactIdleOutbox(work) {
  const { runNewOperation, resolveBot, identity, entry } = work;
  entry.timer = null;
  entry.due = true;
  if (entry.active || entry.running) return;
  entry.due = false;
  entry.running = true;
  entry.dirty = false;
  try {
    await runNewOperation(async () => {
      const bot = resolveBot();
      const now = readServiceClockMs(bot);
      const result = await bot.session.compactAuthorityEvents({
        ...identity,
        retainDeliveredAfter: new Date(
          now - TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs,
        ).toISOString(),
      });
      if (result.hasMore === true) entry.dirty = true;
      scheduleRetentionCompaction(work, result.nextRetainedDeliveryAt, readServiceClockMs(bot));
    });
  } catch (error) {
    entry.dirty = true;
    await recordServiceWebSocketRuntimeError({
      event: "service.authorityOutbox.compactionFailed",
      userId: identity.userId,
      sessionId: identity.sessionId,
      data: { persistenceScope: identity.persistenceScope },
      error,
    });
  } finally {
    entry.running = false;
    scheduleIdleCompaction(work);
  }
}

function scheduleRetentionCompaction(work, deliveredAt, now) {
  if (deliveredAt === null) return;
  const expiresAt =
    Date.parse(deliveredAt) + TIME_THRESHOLDS.agent.authorityOutboxDeliveredRetentionMs + 1;
  if (!Number.isFinite(expiresAt))
    throw new TypeError("Outbox maintenance requires nextRetainedDeliveryAt timestamp or null");
  const { entry } = work;
  if (entry.retentionTimer && entry.retentionAt <= expiresAt) return;
  clearTimeout(entry.retentionTimer);
  entry.retentionAt = expiresAt;
  entry.retentionTimer = setTimeout(
    () => {
      entry.retentionTimer = null;
      entry.retentionAt = null;
      clearTimeout(entry.timer);
      entry.dirty = true;
      void compactIdleOutbox(work);
    },
    Math.max(0, expiresAt - now),
  );
  entry.retentionTimer.unref();
}

function scheduleIdleCompaction(work) {
  const { entries, key, entry } = work;
  if (entry.active || entry.running || entry.timer) return;
  if (!entry.dirty) {
    if (!entry.retentionTimer) entries.delete(key);
    return;
  }
  entry.timer = setTimeout(
    () => void compactIdleOutbox(work),
    entry.due ? 0 : TIME_THRESHOLDS.agent.authorityOutboxCompactIntervalMs,
  );
  entry.timer.unref();
}

export async function withAuthorityOutboxDelivery(
  { runNewOperation, resolveBot },
  payload,
  deliver,
) {
  const identity = {
    userId: payload.userId,
    sessionId: payload.sessionId,
    persistenceScope: payload.persistenceScope,
  };
  let entries = maintenanceByRuntime.get(runNewOperation);
  if (!entries) {
    entries = new Map();
    maintenanceByRuntime.set(runNewOperation, entries);
  }
  const key = JSON.stringify([
    identity.userId,
    identity.sessionId,
    identity.persistenceScope === null ? null : identity.persistenceScope.scopeId,
  ]);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      active: 0,
      timer: null,
      retentionTimer: null,
      retentionAt: null,
      running: false,
      dirty: false,
      due: false,
    };
    entries.set(key, entry);
  }
  entry.active += 1;
  try {
    const result = await deliver(() => {
      entry.dirty = true;
    });
    if (result.dispatched) entry.dirty = true;
    return result;
  } finally {
    entry.active -= 1;
    scheduleIdleCompaction({ runNewOperation, resolveBot, identity, entries, key, entry });
  }
}
