/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./shared/styles/style.css";
import { installElementPlusComponents, installFrontendPlugins } from "./app/entrypoints";

const app = createApp(App);
app.use(createPinia());
installElementPlusComponents(app);
await installFrontendPlugins();
app.mount("#app");
