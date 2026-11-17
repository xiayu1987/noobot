/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createViewerRenderLoop({
  canRender,
  render,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
}) {
  let frame = null;
  let previousTime = null;

  function pause() {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    previousTime = null;
  }

  function invalidate() {
    if (!canRender()) {
      pause();
      return;
    }
    if (frame === null) frame = requestFrame(tick);
  }

  function tick(time) {
    frame = null;
    if (!canRender()) {
      previousTime = null;
      return;
    }
    const delta = previousTime === null ? 0 : (time - previousTime) / 1000;
    previousTime = time;
    if (render(delta)) invalidate();
    else if (frame === null) previousTime = null;
  }

  return { invalidate, pause };
}
