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

const globalStubs = {
  "el-button": ElButtonStub,
  "el-input": ElInputStub,
  "el-switch": ElSwitchStub,
  "el-dialog": ElDialogStub,
  "el-icon": defineComponent({ name: "ElIcon", template: "<span><slot /></span>" }),
};

describe("ComposerInputActions", () => {
  it("emits input, send, stop, more, camera and microphone events", async () => {
    const wrapper = mount(ComposerInputActions, {
      props: {
        modelValue: "",
        canStop: true,
        sendDisabled: false,
        sendButtonText: "发送",
      },
      global: { stubs: globalStubs },
      attachTo: document.body,
    });

    const input = wrapper.find("textarea.chat-input");
    await input.setValue("hello");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["hello"]);

    await input.trigger("keydown", { key: "Enter" });
    await wrapper.find("button.send-btn").trigger("click");
    expect(wrapper.emitted("send")).toHaveLength(2);

    await wrapper.find("button.stop-float-btn").trigger("click");
    expect(wrapper.emitted("stop")).toHaveLength(1);

    await wrapper.find("button[title='更多操作']").trigger("click");
    expect(wrapper.emitted("toggle-more-panel")).toHaveLength(1);

    await wrapper.find("button[title='拍照']").trigger("click");
    expect(wrapper.emitted("open-camera-capture")).toHaveLength(1);

    const micButton = wrapper.find("button[title='按住录音']");
    await micButton.trigger("pointerdown");
    await micButton.trigger("pointermove");
    await micButton.trigger("pointerup");
    expect(wrapper.emitted("mic-pointer-down")).toHaveLength(1);
    expect(wrapper.emitted("mic-pointer-move")).toHaveLength(1);
    expect(wrapper.emitted("mic-pointer-up-or-cancel")).toHaveLength(1);
  });

  it("reflects disabled, loading and recording status", () => {
    const wrapper = mount(ComposerInputActions, {
      props: {
        sending: true,
        sendDisabled: true,
        sendButtonText: "发送中",
        captureActionsDisabled: true,
        micRecording: true,
        micSlideCancelReady: true,
        micStatusText: "松开发送 1",
      },
      global: { stubs: globalStubs },
    });

    expect(wrapper.find("button.send-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.find("button.send-btn").attributes("data-loading")).toBe("true");
    expect(wrapper.find("button[title='拍照']").attributes("disabled")).toBeDefined();
    expect(wrapper.find("button[title='按住录音']").classes()).toContain("is-recording");
    expect(wrapper.find(".mic-status-text").text()).toBe("松开发送 1");
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
      global: { stubs: globalStubs },
    });

    const switches = wrapper.findAll("button.el-switch-stub");
    await switches[0].trigger("click");
    await switches[1].trigger("click");
    await switches[2].trigger("click");
    expect(wrapper.emitted("update:allowUserInteraction")?.[0]).toEqual([false]);
    expect(wrapper.emitted("update:forceTool")?.[0]).toEqual([true]);
    expect(wrapper.emitted("update:streamOutput")?.[0]).toEqual([false]);

    await wrapper.findAll(".scenario-selector button")[1].trigger("click");
    expect(wrapper.emitted("select-scenario")?.[0]).toEqual(["default"]);

    await wrapper.find(".plugin-button-group button").trigger("click");
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
      global: { stubs: globalStubs },
    });

    await wrapper.find(".scenario-selector button").trigger("click");
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
      global: { stubs: globalStubs },
      attachTo: document.body,
    });

    expect(wrapper.find(".el-dialog-stub").attributes("data-title")).toBe("拍照");

    await wrapper.find("input.hidden-camera-input").trigger("change");
    expect(wrapper.emitted("camera-capture-change")).toHaveLength(1);

    await wrapper.findAll("footer button")[1].trigger("click");
    expect(wrapper.emitted("capture-photo-from-camera")).toHaveLength(1);

    await wrapper.findAll("footer button")[0].trigger("click");
    expect(wrapper.emitted("stop-camera-preview")).toHaveLength(1);

    await wrapper.find("button.dialog-close").trigger("click");
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    expect(wrapper.emitted("stop-camera-preview")).toHaveLength(2);
  });
});
