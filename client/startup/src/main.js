/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createApp } from "vue";
import {
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElCheckboxGroup,
  ElDrawer,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElOption,
  ElSelect,
  ElTag,
} from "element-plus";
import "element-plus/dist/index.css";
import "@noobot/client-shared/theme";
import "@noobot/client-shared/styles/theme.css";
import "@noobot/client-shared/styles/element-plus.css";
import App from "./app/App.vue";
import "./style.css";

const app = createApp(App);
for (const component of [
  ElAlert,
  ElButton,
  ElCard,
  ElCheckbox,
  ElCheckboxGroup,
  ElDrawer,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElOption,
  ElSelect,
  ElTag,
]) {
  app.use(component);
}
app.mount("#app");
