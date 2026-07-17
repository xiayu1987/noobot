/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";
import App from "./App.vue";
import "./style.css";

const app = createApp(App);
for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component);
app.use(ElementPlus);
app.mount("#app");
