/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createSocketHandlerRegistry() {
  const socketHandlerStores = new WeakMap();

  function register(socket, owner, handlers = {}) {
    if (!socket || !owner) return () => {};
    let store = socketHandlerStores.get(socket);
    if (!store) {
      store = new Map();
      socketHandlerStores.set(socket, store);
      for (const eventName of ["open", "message", "error", "close"]) {
        socket[`on${eventName}`] = (event) => {
          for (const subscriber of [...store.values()]) {
            subscriber?.[eventName]?.(event);
          }
        };
      }
    }
    store.set(owner, handlers);
    return () => {
      if (store.get(owner) === handlers) store.delete(owner);
    };
  }

  return { register };
}
