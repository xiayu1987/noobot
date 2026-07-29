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
  ElTree,
  ElTooltip,
  ElUpload,
} from "element-plus";
import "element-plus/dist/index.css";
import { registerExternalFrontendPlugins } from "../plugins/auto-register.js";

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
  ElTree,
  ElTooltip,
  ElUpload,
];

export const ChatComposer = defineAsyncComponent(() =>
  import("../modules/composer/components/ChatComposer.vue")
);

export const ChatMessageListPanel = defineAsyncComponent(() =>
  import("../modules/chat/components/navigation/ChatMessageListPanel.vue")
);

export const SessionSidebar = defineAsyncComponent(() =>
  import("../modules/session/components/SessionSidebar.vue")
);

export const WorkspacePanel = defineAsyncComponent(() =>
  import("../modules/settings/panels/WorkspacePanel.vue")
);

export const UserSettingsPanel = defineAsyncComponent(() =>
  import("../modules/settings/panels/UserSettingsPanel.vue")
);

export const ConfigParamsPanel = defineAsyncComponent(() =>
  import("../modules/settings/panels/ConfigParamsPanel.vue")
);

export const UserInteractionForm = defineAsyncComponent(() =>
  import("../modules/composer/components/UserInteractionForm.vue")
);

export const ConversationStateDebugPanel = defineAsyncComponent(() =>
  import("../modules/debug/components/ConversationStateDebugPanel.vue")
);

export function installElementPlusComponents(app) {
  for (const component of ELEMENT_PLUS_COMPONENTS) {
    app.use(component);
  }
}

export async function installFrontendPlugins() {
  await registerExternalFrontendPlugins();
}
