/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineAsyncComponent } from "vue";
import {
  ElAffix,
  ElAnchor,
  ElAnchorLink,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElCollapse,
  ElCollapseItem,
  ElCollapseTransition,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElScrollbar,
  ElSelect,
  ElSkeleton,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTag,
  ElTree,
  ElUpload,
} from "element-plus";
import "element-plus/dist/index.css";
import { registerExternalFrontendPlugins } from "../plugins/auto-register";

const ELEMENT_PLUS_COMPONENTS = [
  ElAffix,
  ElAnchor,
  ElAnchorLink,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElCollapse,
  ElCollapseItem,
  ElCollapseTransition,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElOption,
  ElRadio,
  ElRadioGroup,
  ElScrollbar,
  ElSelect,
  ElSkeleton,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTag,
  ElTree,
  ElUpload,
];

let mermaidModulePromise = null;

export const ChatComposer = defineAsyncComponent(() =>
  import("../modules/composer/ChatComposer.vue")
);

export const ChatMessageListPanel = defineAsyncComponent(() =>
  import("./ChatMessageListPanel.vue")
);

export const SessionSidebar = defineAsyncComponent(() =>
  import("../modules/session/SessionSidebar.vue")
);

export const WorkspacePanel = defineAsyncComponent(() =>
  import("../modules/settings/WorkspacePanel.vue")
);

export const UserSettingsPanel = defineAsyncComponent(() =>
  import("../modules/settings/UserSettingsPanel.vue")
);

export const ConfigParamsPanel = defineAsyncComponent(() =>
  import("../modules/settings/ConfigParamsPanel.vue")
);

export const UserInteractionForm = defineAsyncComponent(() =>
  import("../modules/composer/UserInteractionForm.vue")
);

export const ConversationStateDebugPanel = defineAsyncComponent(() =>
  import("../modules/debug/ConversationStateDebugPanel.vue")
);

export function installElementPlusComponents(app) {
  for (const component of ELEMENT_PLUS_COMPONENTS) {
    app.use(component);
  }
}

export async function installFrontendPlugins() {
  await registerExternalFrontendPlugins();
}

export async function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid").then((module) => module.default || module);
  }
  return mermaidModulePromise;
}
