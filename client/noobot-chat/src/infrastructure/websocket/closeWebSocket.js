/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function closeWebSocket(socket, code = 1000, reason = "close") {
  if (typeof socket?.close !== "function") return false;
  try {
    socket.close(code, reason);
    return true;
  } catch (error) {
    console.warn(`[noobot:websocket] close failed (${reason})`, error);
    return false;
  }
}
