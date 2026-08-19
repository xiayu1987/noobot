/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function destroyStream(stream) {
  if (!stream || stream.destroyed) return;
  try {
    stream.destroy();
  } catch (error) {
    console.warn("[agent-proxy] stream destroy failed", error);
  }
}

export function bridgeDuplexStreams({
  upstream,
  downstream,
  beforePipe = null,
  onError = null,
} = {}) {
  if (!upstream || !downstream) {
    throw new TypeError("upstream and downstream streams are required");
  }

  let finalized = false;
  const finalize = (reason, error = null) => {
    if (finalized) return false;
    finalized = true;
    try {
      upstream.unpipe?.(downstream);
    } catch (error) {
      console.warn("[agent-proxy] upstream unpipe failed", error);
    }
    try {
      downstream.unpipe?.(upstream);
    } catch (error) {
      console.warn("[agent-proxy] downstream unpipe failed", error);
    }
    destroyStream(upstream);
    destroyStream(downstream);
    if (error && typeof onError === "function") {
      try {
        onError({ reason, error });
      } catch (callbackError) {
        console.warn("[agent-proxy] stream error callback failed", callbackError);
      }
    }
    return true;
  };

  // Keep error listeners attached after finalization: either stream may report a
  // second, asynchronous error while destroy() is propagating to its peer.
  upstream.on("error", (error) => finalize("upstream_error", error));
  downstream.on("error", (error) => finalize("downstream_error", error));
  upstream.once("close", () => finalize("upstream_close"));
  downstream.once("close", () => finalize("downstream_close"));
  upstream.once("end", () => finalize("upstream_end"));
  downstream.once("end", () => finalize("downstream_end"));

  try {
    beforePipe?.();
    if (!finalized) {
      upstream.pipe(downstream);
      downstream.pipe(upstream);
    }
  } catch (error) {
    finalize("setup_error", error);
  }

  return {
    close: () => finalize("local_close"),
    get finalized() {
      return finalized;
    },
  };
}
