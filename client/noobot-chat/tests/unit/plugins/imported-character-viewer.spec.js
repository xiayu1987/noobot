/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ImportedCharacterViewer from "../../../../../plugin/noobot-plugin-character/frontend/components/ImportedCharacterViewer.vue";

const state = vi.hoisted(() => ({ draw: vi.fn(), controls: null }));
vi.mock("three", async (original) => ({
  ...(await original()),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    render = state.draw;
    setPixelRatio() {}
    setSize() {}
    dispose() {}
  },
}));
vi.mock("three/addons/loaders/GLTFLoader.js", async () => {
  const THREE = await vi.importActual("three");
  return {
    GLTFLoader: class {
      async loadAsync() {
        return { scene: new THREE.Group(), animations: [new THREE.AnimationClip("Wave", 2, [])] };
      }
    },
  };
});
vi.mock("three/addons/controls/OrbitControls.js", async () => {
  const THREE = await vi.importActual("three");
  return {
    OrbitControls: class extends THREE.EventDispatcher {
      target = new THREE.Vector3();
      constructor() {
        super();
        state.controls = this;
      }
      update() {}
      dispose() {}
    },
  };
});
vi.mock(
  "../../../../../plugin/noobot-plugin-character/frontend/runtime/importedAssetStore.js",
  () => ({
    loadImportedAsset: async () => new Blob(),
  }),
);
vi.mock(
  "../../../../../plugin/noobot-plugin-character/frontend/runtime/characterPhysicsRuntime.js",
  () => ({
    createCharacterPhysicsRuntime: () => ({
      setup: async () => {},
      release() {},
      reset() {},
      step() {},
    }),
  }),
);
vi.mock("../../../../../plugin/noobot-plugin-character/frontend/i18n/index.js", () => ({
  useCharacterLocale: () => ({ translate: (key) => key }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  state.draw.mockClear();
});

it("stops a finished viewer and wakes for controls, resize, replay and visibility without jumping time", async () => {
  const pending = new Map();
  let serial = 0;
  let visibility;
  let resize;
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    const id = serial++;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id) => pending.delete(id));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback) {
        visibility = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:viewer");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const rootTransform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
  const wrapper = mount(ImportedCharacterViewer, {
    props: {
      assets: [{ assetId: "robot", normalization: { scale: 1, floorOffset: 0 } }],
      protocol: {
        duration: 2,
        loop: false,
        scene: { groundY: 0 },
        characters: [
          {
            assetId: "robot",
            rootTransform,
            segments: [{ type: "native_clip", clip: "Wave", start: 0, duration: 2 }],
          },
        ],
      },
    },
  });
  function step(time) {
    const batch = [...pending.values()];
    pending.clear();
    for (const callback of batch) callback(time);
  }
  try {
    await flushPromises();
    visibility([{ isIntersecting: true }]);
    step(0);
    step(1000);
    step(2000);
    const canvas = wrapper.find("canvas").element;
    expect(canvas.dataset.playbackEnded).toBe("true");
    expect(Number(canvas.dataset.playbackTime)).toBe(2);
    expect(pending.size).toBe(0);
    const draws = state.draw.mock.calls.length;
    step(3000);
    expect(state.draw).toHaveBeenCalledTimes(draws);
    state.controls.dispatchEvent({ type: "change" });
    step(4000);
    expect(state.draw).toHaveBeenCalledTimes(draws + 1);
    resize();
    step(5000);
    expect(state.draw).toHaveBeenCalledTimes(draws + 2);
    wrapper.vm.restartPlayback();
    step(10000);
    expect(canvas.dataset.playbackTime).toBe("0");
    step(10500);
    expect(Number(canvas.dataset.playbackTime)).toBe(0.5);
    visibility([{ isIntersecting: false }]);
    expect(pending.size).toBe(0);
    visibility([{ isIntersecting: true }]);
    step(20000);
    expect(Number(canvas.dataset.playbackTime)).toBe(0.5);
    await wrapper.setProps({ revision: 1 });
    await nextTick();
    step(20500);
    expect(canvas.dataset.playbackEnded).toBe("false");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    canvas.toBlob = vi.fn((callback) => callback(new Blob(["image"])));
    wrapper.vm.exportImage();
    expect(canvas.toBlob).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    const stopTrack = vi.fn();
    canvas.captureStream = vi.fn(() => ({ getTracks: () => [{ stop: stopTrack }] }));
    vi.stubGlobal(
      "MediaRecorder",
      class {
        static isTypeSupported() {
          return true;
        }
        state = "inactive";
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable({ data: new Blob(["video"]) });
          this.onstop();
        }
      },
    );
    vi.useFakeTimers();
    try {
      visibility([{ isIntersecting: false }]);
      const recording = wrapper.vm.exportVideo();
      await nextTick();
      expect(wrapper.vm.isRecording).toBe(true);
      step(21000);
      step(24000);
      expect(canvas.dataset.playbackEnded).toBe("true");
      expect(pending.size).toBe(1);
      await vi.advanceTimersByTimeAsync(2500);
      await recording;
      await nextTick();
      expect(stopTrack).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledTimes(2);
      expect(wrapper.vm.isRecording).toBe(false);
      expect(pending.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    await wrapper.setProps({
      protocol: null,
      assets: [{ assetId: "preview", normalization: { scale: 1, floorOffset: 0 } }],
    });
    await flushPromises();
    visibility([{ isIntersecting: true }]);
    step(25000);
    step(26000);
    expect(pending.size).toBe(0);
    const previewDraws = state.draw.mock.calls.length;
    step(27000);
    expect(state.draw).toHaveBeenCalledTimes(previewDraws);
    state.controls.dispatchEvent({ type: "change" });
    step(28000);
    expect(state.draw).toHaveBeenCalledTimes(previewDraws + 1);
    expect(pending.size).toBe(0);
    resize();
    step(29000);
    expect(state.draw).toHaveBeenCalledTimes(previewDraws + 2);
    expect(pending.size).toBe(0);
  } finally {
    wrapper.unmount();
  }
  expect(pending.size).toBe(0);
});
