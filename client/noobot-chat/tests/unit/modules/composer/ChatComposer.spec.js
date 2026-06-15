import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatComposer from "../../../../src/modules/composer/ChatComposer.vue";

const messageMock = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("element-plus", () => ({
  ElMessage: messageMock,
}));

vi.mock("../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key, params = {}) => {
      const labels = {
        "common.moreActions": "更多操作",
        "common.cancel": "取消",
        "composer.attachments": "附件",
        "composer.botScenario": "场景",
        "composer.cameraDialogTitle": "拍照",
        "composer.capturePhoto": "拍照",
        "composer.clear": "清空",
        "composer.inputPlaceholder": "输入消息",
        "composer.recordAudioHold": "按住录音",
        "composer.recordingReleaseToSend": `松开发送 ${params.seconds ?? 0}`,
        "composer.recordingWillCancel": "松开取消",
        "composer.scenarioProgramming": "编程",
        "composer.send": "发送",
        "composer.sending": "发送中",
        "composer.stop": "停止",
      };
      return labels[key] || key;
    },
  }),
}));

async function flushPromises() {
  await Promise.resolve();
  await nextTick();
}

const ElButtonStub = defineComponent({
  name: "ElButton",
  props: {
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    title: { type: String, default: "" },
    type: { type: String, default: "" },
  },
  template:
    '<button type="button" :disabled="disabled" :title="title" :data-loading="loading ? \'true\' : \'false\'" :data-type="type" v-bind="$attrs"><slot /></button>',
});

const ElInputStub = defineComponent({
  name: "ElInput",
  props: {
    modelValue: { type: String, default: "" },
    placeholder: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  template:
    '<textarea class="el-textarea__inner" :value="modelValue" :placeholder="placeholder" v-bind="$attrs" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
});

const ElUploadStub = defineComponent({
  name: "ElUpload",
  props: {
    onChange: { type: Function, default: null },
  },
  setup(props, { expose, slots }) {
    const clearFiles = vi.fn();
    expose({
      clearFiles,
      emitChange(file, fileList) {
        props.onChange?.(file, fileList);
      },
    });
    return () => h("div", { class: "el-upload-stub" }, slots.default?.());
  },
});

const ElDialogStub = defineComponent({
  name: "ElDialog",
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: "" },
  },
  template:
    '<section v-if="modelValue" class="el-dialog-stub" :data-title="title"><slot /><footer><slot name="footer" /></footer></section>',
});

const globalStubs = {
  "el-button": ElButtonStub,
  "el-input": ElInputStub,
  "el-upload": ElUploadStub,
  "el-dialog": ElDialogStub,
  "el-icon": defineComponent({ name: "ElIcon", template: "<span><slot /></span>" }),
  "el-collapse-transition": defineComponent({ name: "ElCollapseTransition", template: "<div><slot /></div>" }),
  "el-switch": defineComponent({ name: "ElSwitch", template: "<button type='button'><slot /></button>" }),
  ConnectorSelectorPanel: defineComponent({ name: "ConnectorSelectorPanel", template: "<div class='connector-selector-stub'></div>" }),
};

function mountComposer(props = {}) {
  return mount(ChatComposer, {
    props: {
      modelValue: "",
      uploadFiles: [],
      sending: false,
      connected: true,
      ...props,
    },
    global: {
      stubs: globalStubs,
    },
    attachTo: document.body,
  });
}

function findSendButton(wrapper) {
  return wrapper.find("button.send-btn");
}

function mockMediaRecorder() {
  const instances = [];
  class MediaRecorderMock {
    static isTypeSupported = vi.fn(() => true);

    constructor(stream, options = {}) {
      this.stream = stream;
      this.mimeType = options.mimeType || "audio/webm";
      this.state = "inactive";
      this.ondataavailable = null;
      this.onstop = null;
      instances.push(this);
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      this.onstop?.();
    }

    pushChunk(blob = new Blob(["voice"], { type: this.mimeType || "audio/webm" })) {
      this.ondataavailable?.({ data: blob });
    }
  }
  vi.stubGlobal("MediaRecorder", MediaRecorderMock);
  return instances;
}

function mockMediaDevices(stream) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => stream),
    },
  });
  return navigator.mediaDevices.getUserMedia;
}

async function triggerPointer(elementWrapper, type, options = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientY", { configurable: true, value: options.clientY ?? 0 });
  Object.defineProperty(event, "pointerId", { configurable: true, value: options.pointerId ?? 1 });
  elementWrapper.element.dispatchEvent(event);
  await nextTick();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T00:00:00.000Z"));
  messageMock.error.mockClear();
  messageMock.info.mockClear();
  messageMock.warning.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("ChatComposer interactions", () => {
  it("keeps send button disabled until connected input or attachments are available", async () => {
    const wrapper = mountComposer({ connected: false });
    expect(findSendButton(wrapper).attributes("disabled")).toBeDefined();

    await wrapper.setProps({ connected: true });
    expect(findSendButton(wrapper).attributes("disabled")).toBeDefined();

    await wrapper.setProps({ modelValue: "hello" });
    expect(findSendButton(wrapper).attributes("disabled")).toBeUndefined();
    await findSendButton(wrapper).trigger("click");
    expect(wrapper.emitted("send")).toHaveLength(1);

    await wrapper.setProps({ modelValue: "", uploadFiles: [{ name: "a.txt" }] });
    expect(findSendButton(wrapper).attributes("disabled")).toBeUndefined();

    await wrapper.setProps({ sending: true, interactionActive: true });
    expect(findSendButton(wrapper).attributes("disabled")).toBeDefined();
    expect(findSendButton(wrapper).attributes("data-loading")).toBe("true");
  });

  it("emits upload changes and clears attachment selection", async () => {
    const wrapper = mountComposer();
    await wrapper.find("button[title='更多操作']").trigger("click");

    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const upload = wrapper.findComponent(ElUploadStub);
    upload.props("onChange")(file, [file]);
    expect(wrapper.emitted("upload-change")?.[0]).toEqual([file, [file]]);

    await wrapper.setProps({ uploadFiles: [file] });
    expect(wrapper.find(".attachment-name").text()).toBe("hello.txt");

    await wrapper.find(".clear-files-btn").trigger("click");
    expect(wrapper.emitted("clear-uploads")).toHaveLength(1);
    expect(upload.vm.$.exposed.clearFiles).toHaveBeenCalledTimes(1);
  });

  it("appends camera input photos as attachments", async () => {
    const wrapper = mountComposer();
    const photo = new File(["jpg"], "camera.jpg", { type: "image/jpeg" });
    const input = wrapper.find("input.hidden-camera-input");

    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [photo],
    });
    await input.trigger("change");

    expect(wrapper.emitted("append-uploads")?.[0]).toEqual([[photo]]);
    expect(input.element.value).toBe("");
  });

  it("appends microphone recordings as attachments on pointer release", async () => {
    const audioTrack = { stop: vi.fn() };
    const getUserMedia = mockMediaDevices({ getTracks: () => [audioTrack] });
    const recorderInstances = mockMediaRecorder();
    const wrapper = mountComposer();

    const micButton = wrapper.find("button[title='按住录音']");
    await triggerPointer(micButton, "pointerdown", { clientY: 100, pointerId: 1 });
    await flushPromises();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(recorderInstances).toHaveLength(1);
    recorderInstances[0].pushChunk();

    await triggerPointer(micButton, "pointerup", { clientY: 100, pointerId: 1 });
    await nextTick();

    const appendedFile = wrapper.emitted("append-uploads")?.[0]?.[0]?.[0];
    expect(appendedFile).toBeInstanceOf(File);
    expect(appendedFile.name).toMatch(/^voice-.*\.webm$/);
    expect(appendedFile.type).toBe("audio/webm");
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("cancels active capture when sending starts", async () => {
    const audioTrack = { stop: vi.fn() };
    mockMediaDevices({ getTracks: () => [audioTrack] });
    const recorderInstances = mockMediaRecorder();
    const wrapper = mountComposer();

    const micButton = wrapper.find("button[title='按住录音']");
    await triggerPointer(micButton, "pointerdown", { clientY: 100, pointerId: 1 });
    await flushPromises();
    recorderInstances[0].pushChunk();

    await wrapper.setProps({ sending: true });
    await nextTick();

    expect(wrapper.emitted("append-uploads")).toBeUndefined();
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("shows selected scenario, connectors, and plugin tags at the top", () => {
    const wrapper = mountComposer({
      botScenario: "programming",
      connectorPanelState: {
        selectedConnectors: {
          database: "prod-db",
          terminal: "ops-shell",
          email: "alerts-mail",
        },
      },
      availablePlugins: [
        { key: "workflow", label: "工作流", enabled: true },
        { key: "harness", label: "Harness", enabled: true },
      ],
      selectedPlugins: ["workflow"],
    });

    const tagText = wrapper.find(".selected-connectors-row").text();
    expect(tagText).toContain("场景: 编程");
    expect(tagText).toContain("prod-db");
    expect(tagText).toContain("ops-shell");
    expect(tagText).toContain("alerts-mail");
    expect(tagText).toContain("工作流");
    expect(tagText).not.toContain("Harness");
  });
});
