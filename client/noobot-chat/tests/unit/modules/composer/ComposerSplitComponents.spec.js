import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ComposerInputActions from "../../../../src/modules/composer/ComposerInputActions.vue";
import ComposerMoreOptions from "../../../../src/modules/composer/ComposerMoreOptions.vue";
import ComposerCameraDialog from "../../../../src/modules/composer/ComposerCameraDialog.vue";

vi.mock("../../../../src/shared/i18n/useLocale", () => ({
  useLocale: () => ({
    translate: (key, params = {}) => {
      const labels = {
        "common.cancel": "取消",
        "common.moreActions": "更多操作",
        "composer.allowInteraction": "允许交互",
        "composer.availablePlugins": "插件",
        "composer.botScenario": "场景",
        "composer.cameraDialogTitle": "拍照",
        "composer.capturePhoto": "拍照",
        "composer.disallowInteraction": "禁止交互",
        "composer.forceTool": "强制工具",
        "composer.inputPlaceholder": "输入消息",
        "composer.noAvailablePlugins": "暂无插件",
        "composer.nonStreaming": "非流式",
        "composer.notForceTool": "不强制工具",
        "composer.recordAudioHold": "按住录音",
        "composer.scenarioProgramming": "编程",
        "composer.send": "发送",
        "composer.streaming": "流式",
        "composer.stop": "停止",
      };
      return labels[key] || `${key}${params.seconds ?? ""}`;
    },
  }),
}));

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

const ElSwitchStub = defineComponent({
  name: "ElSwitch",
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  template:
    '<button type="button" class="el-switch-stub" :data-value="modelValue ? \'true\' : \'false\'" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
});

const ElDialogStub = defineComponent({
  name: "ElDialog",
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: "" },
  },
  emits: ["update:modelValue", "closed"],
  template:
    '<section v-if="modelValue" class="el-dialog-stub" :data-title="title"><slot /><footer><slot name="footer" /></footer><button class="dialog-close" type="button" @click="$emit(\'update:modelValue\', false); $emit(\'closed\')">x</button></section>',
});

const ElTagStub = defineComponent({
  name: "ElTag",
  template: '<span class="el-tag-stub" v-bind="$attrs"><slot /></span>',
});

const ElSelectStub = defineComponent({
  name: "ElSelect",
  props: {
    modelValue: { type: [String, Number, Boolean], default: "" },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  template:
    '<select class="el-select-stub" :value="modelValue" :disabled="disabled" v-bind="$attrs" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
});

const ElOptionStub = defineComponent({
  name: "ElOption",
  props: {
    label: { type: String, default: "" },
    value: { type: [String, Number, Boolean], default: "" },
  },
  template: '<option class="el-option-stub" :value="value"><slot>{{ label }}</slot></option>',
});

const globalStubs = {
  ElButton: ElButtonStub,
  "el-button": ElButtonStub,
  ElInput: ElInputStub,
  "el-input": ElInputStub,
  ElSwitch: ElSwitchStub,
  "el-switch": ElSwitchStub,
  ElDialog: ElDialogStub,
  "el-dialog": ElDialogStub,
  ElTag: ElTagStub,
  "el-tag": ElTagStub,
  ElSelect: ElSelectStub,
  "el-select": ElSelectStub,
  ElOption: ElOptionStub,
  "el-option": ElOptionStub,
  ElIcon: defineComponent({ name: "ElIcon", template: "<span><slot /></span>" }),
  "el-icon": defineComponent({ name: "ElIcon", template: "<span><slot /></span>" }),
};

const globalMountOptions = {
  components: globalStubs,
  stubs: globalStubs,
};

async function dispatchKeydown(elementWrapper, options = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...options,
  });
  if (Object.prototype.hasOwnProperty.call(options, "isComposing")) {
    Object.defineProperty(event, "isComposing", {
      configurable: true,
      value: options.isComposing,
    });
  }
  if (Object.prototype.hasOwnProperty.call(options, "keyCode")) {
    Object.defineProperty(event, "keyCode", {
      configurable: true,
      value: options.keyCode,
    });
  }
  if (Object.prototype.hasOwnProperty.call(options, "which")) {
    Object.defineProperty(event, "which", {
      configurable: true,
      value: options.which,
    });
  }
  elementWrapper.element.dispatchEvent(event);
  await nextTick();
  return event;
}

describe("ComposerInputActions", () => {
  it("emits input, send, stop, more, camera and microphone events", async () => {
    const wrapper = mount(ComposerInputActions, {
      props: {
        modelValue: "",
        canStop: true,
        sendDisabled: false,
        sendButtonText: "发送",
      },
      global: globalMountOptions,
      attachTo: document.body,
    });

    wrapper.vm.$emit("update:modelValue", "hello");
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["hello"]);

    const input = wrapper.find("el-input.chat-input");
    await input.trigger("keydown", { key: "Enter" });
    await wrapper.find("el-button.send-btn").trigger("click");
    expect(wrapper.emitted("send")).toHaveLength(2);

    await wrapper.find("el-button.stop-float-btn").trigger("click");
    expect(wrapper.emitted("stop")).toHaveLength(1);

    await wrapper.find("el-button[title='更多操作']").trigger("click");
    expect(wrapper.emitted("toggle-more-panel")).toHaveLength(1);

    await wrapper.find("el-button[title='拍照']").trigger("click");
    expect(wrapper.emitted("open-camera-capture")).toHaveLength(1);

    const micButton = wrapper.find("el-button[title='按住录音']");
    await micButton.trigger("pointerdown");
    await micButton.trigger("pointermove");
    await micButton.trigger("pointerup");
    expect(wrapper.emitted("mic-pointer-down")).toHaveLength(1);
    expect(wrapper.emitted("mic-pointer-move")).toHaveLength(1);
    expect(wrapper.emitted("mic-pointer-up-or-cancel")).toHaveLength(1);
  });

  it("reflects disabled, request loading and recording status", () => {
    const wrapper = mount(ComposerInputActions, {
      props: {
        sending: true,
        sendRequesting: true,
        sendDisabled: true,
        sendButtonText: "发送中",
        captureActionsDisabled: true,
        micRecording: true,
        micSlideCancelReady: true,
        micStatusText: "松开发送 1",
      },
      global: globalMountOptions,
    });

    expect(wrapper.find("el-button.send-btn").attributes("disabled")).toBe("true");
    expect(wrapper.find("el-button.send-btn").attributes("loading")).toBe("true");
    expect(wrapper.find("el-button[title='拍照']").attributes("disabled")).toBe("true");
    expect(wrapper.find("el-button[title='按住录音']").classes()).toContain("is-recording");
    expect(wrapper.find(".mic-status-text").text()).toBe("松开发送 1");
  });

  it("keeps backend sending separate from frontend send request loading", () => {
    const wrapper = mount(ComposerInputActions, {
      props: {
        sending: true,
        sendRequesting: false,
        sendDisabled: false,
        sendButtonText: "发送中",
      },
      global: globalMountOptions,
    });

    const sendButton = wrapper.find("el-button.send-btn");
    expect(sendButton.attributes("loading")).toBe("false");
    expect(sendButton.attributes("disabled")).toBe("false");
    expect(sendButton.text()).toBe("发送中");
  });

  it("uses stop request state for stop button loading and disabled", () => {
    const wrapper = mount(ComposerInputActions, {
      props: {
        canStop: true,
        stopRequesting: true,
        sendButtonText: "发送",
      },
      global: globalMountOptions,
    });

    const stopButton = wrapper.find("el-button.stop-float-btn");
    expect(stopButton.attributes("loading")).toBe("true");
    expect(stopButton.attributes("disabled")).toBe("true");
  });

  it("does not send when Enter confirms an active IME composition", async () => {
    const wrapper = mount(ComposerInputActions, {
      props: {
        modelValue: "拼",
        sendButtonText: "发送",
      },
      global: globalMountOptions,
      attachTo: document.body,
    });
    const input = wrapper.find("el-input.chat-input");

    await dispatchKeydown(input, { isComposing: true });
    await dispatchKeydown(input, { keyCode: 229 });
    await dispatchKeydown(input, { which: 229 });
    expect(wrapper.emitted("send")).toBeUndefined();

    await dispatchKeydown(input);
    expect(wrapper.emitted("send")).toHaveLength(1);
  });
});

describe("ComposerMoreOptions", () => {
  it("emits session option, scenario and plugin events", async () => {
    const resolveScenarioLabel = vi.fn((item) => item.label || item.key);
    const wrapper = mount(ComposerMoreOptions, {
      props: {
        allowUserInteraction: true,
        forceTool: false,
        streamOutput: true,
        botScenario: "programming",
        normalizedScenarioOptions: [
          { key: "programming", label: "编程", description: "code" },
          { key: "default", label: "默认" },
        ],
        selectedScenarioDescription: "code",
        normalizedPluginOptions: [
          { key: "workflow", label: "工作流" },
          { key: "disabled", label: "禁用", enabled: false },
        ],
        selectedPluginKeySet: new Set(["workflow"]),
        resolveScenarioLabel,
      },
      global: globalMountOptions,
    });

    wrapper.vm.$emit("update:allowUserInteraction", false);
    wrapper.vm.$emit("update:forceTool", true);
    wrapper.vm.$emit("update:streamOutput", false);
    await nextTick();
    expect(wrapper.emitted("update:allowUserInteraction")?.[0]).toEqual([false]);
    expect(wrapper.emitted("update:forceTool")?.[0]).toEqual([true]);
    expect(wrapper.emitted("update:streamOutput")?.[0]).toEqual([false]);

    await wrapper.findAll(".scenario-selector el-button")[1].trigger("click");
    expect(wrapper.emitted("select-scenario")?.[0]).toEqual(["default"]);

    await wrapper.find(".plugin-button-group el-button").trigger("click");
    expect(wrapper.emitted("toggle-plugin")?.[0]).toEqual(["workflow"]);
    expect(wrapper.find(".scenario-description").text()).toBe("code");
  });

  it("shows fallback programming scenario and plugin empty state", async () => {
    const wrapper = mount(ComposerMoreOptions, {
      props: {
        normalizedScenarioOptions: [],
        normalizedPluginOptions: [],
        selectedPluginKeySet: new Set(),
        resolveScenarioLabel: (item) => item.label || item.key,
      },
      global: globalMountOptions,
    });

    await wrapper.find(".scenario-selector el-button").trigger("click");
    expect(wrapper.emitted("toggle-programming-scenario")).toHaveLength(1);
    expect(wrapper.find(".plugin-empty-text").text()).toBe("暂无插件");
  });
});

describe("ComposerCameraDialog", () => {
  it("emits camera input, capture and cleanup events", async () => {
    const wrapper = mount(ComposerCameraDialog, {
      props: {
        modelValue: true,
        cameraInputRef: null,
        cameraVideoRef: null,
      },
      global: globalMountOptions,
      attachTo: document.body,
    });

    expect(wrapper.find("el-dialog").attributes("title")).toBe("拍照");

    await wrapper.find("input.hidden-camera-input").trigger("change");
    expect(wrapper.emitted("camera-capture-change")).toHaveLength(1);

    wrapper.vm.$emit("capture-photo-from-camera");
    await nextTick();
    expect(wrapper.emitted("capture-photo-from-camera")).toHaveLength(1);

    wrapper.vm.$emit("stop-camera-preview");
    await nextTick();
    expect(wrapper.emitted("stop-camera-preview")).toHaveLength(1);

    wrapper.vm.$emit("update:modelValue", false);
    wrapper.vm.$emit("stop-camera-preview");
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    expect(wrapper.emitted("stop-camera-preview")).toHaveLength(2);
  });
});
