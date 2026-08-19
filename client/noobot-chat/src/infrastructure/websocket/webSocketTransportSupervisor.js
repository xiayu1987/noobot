/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { closeWebSocket } from "./closeWebSocket.js";

export const WEB_SOCKET_TRANSPORT_PHASE = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  OPEN: "open",
  SUSPENDED: "suspended",
  DISPOSED: "disposed",
});

export function createWebSocketTransportSupervisor({
  channelId = "websocket",
  resolveWebSocketUrl = () => "",
  resolveTransportOwner = () => "",
  createWebSocket = (url) => new WebSocket(url),
  refreshAuthentication = null,
  reconnectBaseDelayMs = 0,
  reconnectMaxDelayMs = reconnectBaseDelayMs,
} = {}) {
  let socket = null;
  let connectionUrl = "";
  let transportOwner = "";
  let generation = 0;
  let phase = WEB_SOCKET_TRANSPORT_PHASE.IDLE;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let authenticationRecoveryAttempted = false;
  let authenticationRecoveryPromise = null;
  let serverInstanceId = "";
  let lastFailureReason = "";

  function isTerminal() {
    return phase === WEB_SOCKET_TRANSPORT_PHASE.DISPOSED;
  }

  function isCurrent(candidate) {
    return Boolean(candidate && candidate === socket && !isTerminal());
  }

  function current() {
    return socket;
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function resolveConnectionUrl() {
    try {
      return String(resolveWebSocketUrl() || "").trim();
    } catch (error) {
      reconnectAttempt += 1;
      lastFailureReason = String(error?.name || "websocket_url_resolution_failed").trim();
      return "";
    }
  }

  function resolveOwner() {
    return String(resolveTransportOwner() || "").trim();
  }

  function createAttempt(resolvedUrl = "", resolvedOwner = resolveOwner()) {
    if (isTerminal() || phase === WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED) return null;
    clearReconnectTimer();
    const url = resolvedUrl || resolveConnectionUrl();
    if (!url) return null;
    const previousSocket = socket;
    const previousOwner = transportOwner;
    let nextSocket = null;
    try {
      nextSocket = createWebSocket(url);
    } catch (error) {
      reconnectAttempt += 1;
      lastFailureReason = String(error?.name || "websocket_constructor_failed").trim();
      return null;
    }
    if (!nextSocket) {
      reconnectAttempt += 1;
      lastFailureReason = "websocket_constructor_returned_empty";
      return null;
    }
    generation += 1;
    socket = nextSocket;
    connectionUrl = url;
    transportOwner = resolvedOwner;
    authenticationRecoveryAttempted = false;
    serverInstanceId = "";
    lastFailureReason = "";
    phase =
      nextSocket?.readyState === WebSocket.OPEN
        ? WEB_SOCKET_TRANSPORT_PHASE.OPEN
        : WEB_SOCKET_TRANSPORT_PHASE.CONNECTING;
    return { socket: nextSocket, previousSocket, previousOwner, transportOwner, generation };
  }

  function acquire() {
    const resolvedUrl = resolveConnectionUrl();
    const resolvedOwner = resolveOwner();
    if (!resolvedUrl) return null;
    if (
      socket &&
      connectionUrl === resolvedUrl &&
      [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)
    ) {
      return { socket, previousSocket: null, generation, reused: true };
    }
    const attempt = createAttempt(resolvedUrl, resolvedOwner);
    if (!attempt?.socket) return attempt;
    if (attempt.previousSocket && attempt.previousSocket !== attempt.socket) {
      closeWebSocket(attempt.previousSocket, 1000, "transport_identity_changed");
    }
    return {
      ...attempt,
      credentialsChanged: Boolean(attempt.previousSocket),
      identityChanged: Boolean(
        attempt.previousSocket && attempt.previousOwner !== attempt.transportOwner,
      ),
    };
  }

  function replace() {
    return createAttempt();
  }

  function markOpen(candidate) {
    if (!isCurrent(candidate)) return false;
    clearReconnectTimer();
    phase = WEB_SOCKET_TRANSPORT_PHASE.OPEN;
    reconnectAttempt = 0;
    authenticationRecoveryAttempted = false;
    return true;
  }

  function markReady(candidate, { nextServerInstanceId = "" } = {}) {
    if (!markOpen(candidate)) return false;
    serverInstanceId = String(nextServerInstanceId || "").trim();
    return true;
  }

  function release(candidate) {
    if (!isCurrent(candidate)) return false;
    generation += 1;
    socket = null;
    connectionUrl = "";
    transportOwner = "";
    phase = WEB_SOCKET_TRANSPORT_PHASE.IDLE;
    return true;
  }

  function noteFailure(candidate) {
    if (!release(candidate)) return false;
    reconnectAttempt += 1;
    return true;
  }

  function refreshCredentials() {
    if (isTerminal() || phase === WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED) {
      return Promise.resolve(false);
    }
    if (authenticationRecoveryPromise) return authenticationRecoveryPromise;
    if (authenticationRecoveryAttempted || typeof refreshAuthentication !== "function") {
      return Promise.resolve(null);
    }
    authenticationRecoveryAttempted = true;
    authenticationRecoveryPromise = Promise.resolve()
      .then(() => refreshAuthentication())
      .then((recovered) => recovered === true)
      .catch(() => false)
      .finally(() => {
        authenticationRecoveryPromise = null;
      });
    return authenticationRecoveryPromise;
  }

  function scheduleReconnect(callback, { immediate = false } = {}) {
    if (isTerminal() || phase === WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED || reconnectTimer)
      return false;
    if (immediate) {
      callback?.();
      return true;
    }
    const baseDelay = Math.max(0, Number(reconnectBaseDelayMs || 0));
    const maxDelay = Math.max(baseDelay, Number(reconnectMaxDelayMs || baseDelay));
    const delayMs = Math.min(maxDelay, baseDelay * 2 ** Math.max(0, reconnectAttempt - 1));
    const scheduledGeneration = generation;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (
        generation !== scheduledGeneration ||
        isTerminal() ||
        phase === WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED
      )
        return;
      callback?.();
    }, delayMs);
    return true;
  }

  function recover({ reconnect = null, suspendOnAuthenticationFailure = false } = {}) {
    if (isTerminal() || phase === WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED)
      return Promise.resolve(false);
    if (typeof refreshAuthentication !== "function") {
      return Promise.resolve(scheduleReconnect(reconnect));
    }
    return refreshCredentials().then((recovered) => {
      if (recovered === true || recovered === null) return scheduleReconnect(reconnect);
      if (suspendOnAuthenticationFailure) suspend();
      return suspendOnAuthenticationFailure ? false : scheduleReconnect(reconnect);
    });
  }

  function suspend(candidate = socket) {
    if (candidate && candidate !== socket) return false;
    generation += 1;
    clearReconnectTimer();
    socket = null;
    connectionUrl = "";
    transportOwner = "";
    phase = WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED;
    return true;
  }

  function resume() {
    if (isTerminal()) return false;
    if (phase === WEB_SOCKET_TRANSPORT_PHASE.SUSPENDED) {
      generation += 1;
      phase = WEB_SOCKET_TRANSPORT_PHASE.IDLE;
    }
    reconnectAttempt = 0;
    authenticationRecoveryAttempted = false;
    return true;
  }

  function dispose({ code = 1000, reason = "dispose" } = {}) {
    if (isTerminal()) return;
    const currentSocket = socket;
    generation += 1;
    clearReconnectTimer();
    socket = null;
    connectionUrl = "";
    transportOwner = "";
    phase = WEB_SOCKET_TRANSPORT_PHASE.DISPOSED;
    closeWebSocket(currentSocket, code, reason);
  }

  function status() {
    return {
      channelId,
      generation,
      phase,
      readyState: socket?.readyState ?? WebSocket.CLOSED,
      hasSocket: Boolean(socket),
      reconnectAttempt,
      hasReconnectTimer: Boolean(reconnectTimer),
      authenticationRecoveryAttempted,
      authenticationRecoveryInFlight: Boolean(authenticationRecoveryPromise),
      serverInstanceId,
      lastFailureReason,
    };
  }

  return {
    acquire,
    replace,
    current,
    isCurrent,
    markOpen,
    markReady,
    release,
    noteFailure,
    refreshCredentials,
    scheduleReconnect,
    recover,
    suspend,
    resume,
    dispose,
    status,
  };
}
