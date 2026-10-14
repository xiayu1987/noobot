/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import {
  OVERLAY_DEPTH_STATE_KEY,
  trackOverlayPromise,
  useOverlayHistory,
} from "../../../../src/shared/composables/useOverlayHistory.js";

function waitForPopState() {
  return new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
}

function currentDepth() {
  return window.history.state?.[OVERLAY_DEPTH_STATE_KEY] || 0;
}

function bindOverlay(visible) {
  const scope = effectScope();
  scope.run(() => useOverlayHistory(visible, () => (visible.value = false)));
  return scope;
}

describe("useOverlayHistory", () => {
  it("closes only the top-most overlay on back navigation", async () => {
    const parent = ref(false);
    const child = ref(false);
    const scopes = [bindOverlay(parent), bindOverlay(child)];

    parent.value = true;
    child.value = true;
    expect(currentDepth()).toBe(2);

    window.history.back();
    await waitForPopState();
    expect(child.value).toBe(false);
    expect(parent.value).toBe(true);

    window.history.back();
    await waitForPopState();
    expect(parent.value).toBe(false);
    expect(currentDepth()).toBe(0);
    scopes.forEach((scope) => scope.stop());
  });

  it("rewinds its own entry when the UI closes the overlay", async () => {
    const visible = ref(false);
    const scope = bindOverlay(visible);
    visible.value = true;
    expect(currentDepth()).toBe(1);

    const popped = waitForPopState();
    visible.value = false;
    await popped;
    expect(currentDepth()).toBe(0);
    scope.stop();
  });

  it("does not push again while the overlay stays open", async () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const visible = ref(true);
    const scope = bindOverlay(visible);
    visible.value = true;
    await nextTick();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(currentDepth()).toBe(1);
    pushSpy.mockRestore();

    const popped = waitForPopState();
    scope.stop();
    await popped;
    expect(currentDepth()).toBe(0);
  });

  it("rejects a tracked promise with cancel on back navigation", async () => {
    let dismissed = false;
    const tracked = trackOverlayPromise(new Promise(() => {}), () => (dismissed = true));
    expect(currentDepth()).toBe(1);

    window.history.back();
    await expect(tracked).rejects.toBe("cancel");
    expect(dismissed).toBe(true);
    expect(currentDepth()).toBe(0);
  });

  it("settles a tracked promise normally and rewinds its entry", async () => {
    const popped = waitForPopState();
    await expect(trackOverlayPromise(Promise.resolve("confirm"))).resolves.toBe("confirm");
    await popped;
    expect(currentDepth()).toBe(0);
  });
});
