/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const SYSTEM_CLOCK_PORT = Object.freeze({
  now: () => new Date(),
  sleep: (ms, { signal } = {}) =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
});
