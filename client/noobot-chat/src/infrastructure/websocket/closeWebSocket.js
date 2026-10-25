/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const WEB_SOCKET_CLOSE_CODE = Object.freeze({
  NORMAL: 1000,
  CLIENT_TRANSPORT_FAILURE: 4000,
});

export function closeWebSocket(socket, code = WEB_SOCKET_CLOSE_CODE.NORMAL, reason = "close") {
  if (typeof socket?.close !== "function") return false;
  try {
    socket.close(code, reason);
    return true;
  } catch (error) {
    console.warn(`[noobot:websocket] close failed (${reason})`, error);
    return false;
  }
}
