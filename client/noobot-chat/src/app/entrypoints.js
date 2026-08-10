/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { defineAsyncComponent } from "vue";
import * as ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import { registerExternalFrontendPlugins } from "../plugins/auto-register.js";

const ELEMENT_PLUS_COMPONENT_NAMES = [
  "ElAffix",
  "ElAnchor",
  "ElAnchorLink",
  "ElButton",
  "ElCheckbox",
  "ElCheckboxGroup",
  "ElCollapse",
  "ElCollapseItem",
  "ElCollapseTransition",
  "ElDialog",
  "ElDrawer",
  "ElDropdown",
  "ElDropdownItem",
  "ElDropdownMenu",
  "ElEmpty",
  "ElForm",
  "ElFormItem",
  "ElIcon",
  "ElInput",
  "ElInputNumber",
  "ElOption",
  "ElPopover",
  "ElRadio",
  "ElRadioGroup",
  "ElScrollbar",
  "ElSelect",
  "ElSkeleton",
  "ElSlider",
  "ElStep",
  "ElSteps",
  "ElSwitch",
  "ElTabPane",
  "ElTabs",
  "ElTag",
  "ElTree",
  "ElTooltip",
  "ElUpload",
];

const asyncVueComponent = (loader) => defineAsyncComponent(loader);

export const ChatComposer = asyncVueComponent(
  () => import("../modules/composer/components/ChatComposer.vue"),
);

export const ChatMessageListPanel = asyncVueComponent(
  () => import("../modules/chat/components/navigation/ChatMessageListPanel.vue"),
);

export const SessionSidebar = asyncVueComponent(
  () => import("../modules/session/components/SessionSidebar.vue"),
);

export const WorkspacePanel = asyncVueComponent(
  () => import("../modules/settings/panels/WorkspacePanel.vue"),
);

export const UserSettingsPanel = asyncVueComponent(
  () => import("../modules/settings/panels/UserSettingsPanel.vue"),
);

export const ConfigParamsPanel = asyncVueComponent(
  () => import("../modules/settings/panels/ConfigParamsPanel.vue"),
);

export const UserInteractionForm = asyncVueComponent(
  () => import("../modules/composer/components/UserInteractionForm.vue"),
);

export const ConversationStateDebugPanel = asyncVueComponent(
  () => import("../modules/debug/components/ConversationStateDebugPanel.vue"),
);

export function installElementPlusComponents(app) {
  for (const componentName of ELEMENT_PLUS_COMPONENT_NAMES) {
    app.use(ElementPlus[componentName]);
  }
}

export async function installFrontendPlugins() {
  await registerExternalFrontendPlugins();
}
