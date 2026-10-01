/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameHealthSampler } from "../../../../src/infrastructure/websocket/frameHealthSampler.js";

function stubObserver(supportedEntryTypes) {
  const observers = [];
  class FakeObserver {
    static supportedEntryTypes = supportedEntryTypes;
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(options) {
      this.options = options;
    }
    emit(entries) {
      this.callback({ getEntries: () => entries });
    }
  }
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  return observers;
}

describe("frameHealthSampler", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("attributes long animation frames to script, style/layout and render once per drain", () => {
    const observers = stubObserver(["longtask", "long-animation-frame"]);
    const sampler = createFrameHealthSampler();
    sampler.start();
    sampler.start();
    expect(observers).toHaveLength(1);
    expect(observers[0].options.type).toBe("long-animation-frame");

    observers[0].emit([
      {
        startTime: 100,
        duration: 170,
        blockingDuration: 120,
        renderStart: 200,
        styleAndLayoutStart: 220,
        scripts: [
          {
            duration: 90,
            invoker: "WebSocket.onmessage",
            sourceFunctionName: "a",
            sourceURL: "x.js",
          },
          { duration: 5, invoker: "rAF", sourceFunctionName: "b", sourceURL: "y.js" },
        ],
      },
    ]);
    const first = sampler.drain();
    expect(first).toEqual(
      expect.objectContaining({
        kind: "long-animation-frame",
        longFrameCount: 1,
        maxMs: 170,
        maxBlockingMs: 120,
        scriptMs: 95,
        renderMs: 70,
        styleLayoutMs: 50,
      }),
    );
    expect(first.topScripts[0]).toEqual(
      expect.objectContaining({ durationMs: 90, invoker: "WebSocket.onmessage" }),
    );
    expect(sampler.drain().longFrameCount).toBe(0);
  });

  it("falls back to longtask and reports unsupported without an observer", () => {
    const observers = stubObserver(["longtask"]);
    const sampler = createFrameHealthSampler();
    sampler.start();
    expect(observers[0].options.type).toBe("longtask");
    observers[0].emit([{ startTime: 0, duration: 80 }]);
    expect(sampler.drain()).toEqual(
      expect.objectContaining({ kind: "longtask", longFrameCount: 1, maxMs: 80, scriptMs: 0 }),
    );

    vi.stubGlobal("PerformanceObserver", undefined);
    const unsupported = createFrameHealthSampler();
    unsupported.start();
    expect(unsupported.drain()).toEqual(
      expect.objectContaining({ kind: "unsupported", longFrameCount: 0 }),
    );
  });
});
