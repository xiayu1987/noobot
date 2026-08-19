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
  ElInputNumber,
  ElOption,
  ElPopover,
  ElRadio,
  ElRadioGroup,
  ElScrollbar,
  ElSelect,
  ElSkeleton,
  ElSlider,
  ElStep,
  ElSteps,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElTag,
  ElTooltip,
  ElTree,
  ElUpload,
} from "element-plus";
import "element-plus/dist/index.css";
import { registerExternalFrontendPlugins } from "../plugins/auto-register.js";

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
  app.use(ElAffix);
  app.use(ElAnchor);
  app.use(ElAnchorLink);
  app.use(ElButton);
  app.use(ElCheckbox);
  app.use(ElCheckboxGroup);
  app.use(ElCollapse);
  app.use(ElCollapseItem);
  app.use(ElCollapseTransition);
  app.use(ElDialog);
  app.use(ElDrawer);
  app.use(ElDropdown);
  app.use(ElDropdownItem);
  app.use(ElDropdownMenu);
  app.use(ElEmpty);
  app.use(ElForm);
  app.use(ElFormItem);
  app.use(ElIcon);
  app.use(ElInput);
  app.use(ElInputNumber);
  app.use(ElOption);
  app.use(ElPopover);
  app.use(ElRadio);
  app.use(ElRadioGroup);
  app.use(ElScrollbar);
  app.use(ElSelect);
  app.use(ElSkeleton);
  app.use(ElSlider);
  app.use(ElStep);
  app.use(ElSteps);
  app.use(ElSwitch);
  app.use(ElTabPane);
  app.use(ElTabs);
  app.use(ElTag);
  app.use(ElTooltip);
  app.use(ElTree);
  app.use(ElUpload);
}

export async function installFrontendPlugins() {
  await registerExternalFrontendPlugins();
}
