/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import { ElMessage } from "element-plus";
import App from "./app/shell/App.vue";
import "./shared/styles/style.css";
import { installElementPlusComponents, installFrontendPlugins } from "./app/entrypoints.js";
import { installGlobalErrorBoundary } from "./app/globalErrorBoundary.js";

const app = createApp(App);
installGlobalErrorBoundary(app, { target: window, notifyError: ElMessage.error });
app.use(createPinia());
installElementPlusComponents(app);
await installFrontendPlugins();
app.mount("#app");
