<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { Menu, MoreFilled, Setting } from "@element-plus/icons-vue";
import { useLocale } from "../shared/i18n/useLocale";
import { useTheme } from "../shared/theme/useTheme";

defineProps({
  title: { type: String, default: "" },
  userId: { type: String, default: "" },
  isSuperAdmin: { type: Boolean, default: false },
});

const emit = defineEmits(["toggle-sidebar", "open-workspace", "open-user-settings", "open-config-params"]);
const { t, locale, setLocale } = useLocale();
const { theme, applyTheme } = useTheme();

function handleHeaderAction(command = "") {
  if (command === "workspace") return emit("open-workspace");
  if (command === "user-settings") return emit("open-user-settings");
  if (command === "config-params") return emit("open-config-params");
  if (command === "lang_zh") return setLocale("zh-CN");
  if (command === "lang_en") return setLocale("en-US");
  if (command === "theme_system") return applyTheme("system");
  if (command === "theme_dark") return applyTheme("dark");
  if (command === "theme_light") return applyTheme("light");
}
</script>

<template>
  <header class="chat-header">
    <div class="chat-header-main">
      <button
        class="mobile-menu-btn noobot-action-btn noobot-flat-soft-btn"
        type="button"
        @click="emit('toggle-sidebar')"
        :title="t('common.openSidebar')"
      >
        <el-icon><Menu /></el-icon>
      </button>
      <div class="header-info">
        <h2 class="head-title">{{ title || t("common.session") }}</h2>
        <span class="head-sub">{{ t("common.currentUser", { userId }) }}</span>
      </div>
      <div class="header-spacer"></div>
      <div class="desktop-header-actions">
        <el-button class="workspace-btn noobot-action-btn noobot-flat-soft-btn" @click="emit('open-workspace')">
          {{ t("common.workspace") }}
        </el-button>
        <el-button
          v-if="isSuperAdmin"
          class="workspace-btn noobot-action-btn noobot-flat-soft-btn"
          @click="emit('open-user-settings')"
        >
          {{ t("common.userSettings") }}
        </el-button>
        <el-button class="workspace-btn noobot-action-btn noobot-flat-soft-btn" @click="emit('open-config-params')">
          {{ t("common.configParams") }}
        </el-button>
      <el-dropdown
        class="settings-dropdown"
        trigger="click"
        popper-class="noobot-settings-dropdown"
        @command="handleHeaderAction"
      >
          <el-button
            class="workspace-btn settings-btn noobot-action-btn noobot-flat-soft-btn"
            native-type="button"
            :icon="Setting"
            :title="t('common.moreActions')"
          />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>{{ t("common.english") }} / {{ t("common.chinese") }}</el-dropdown-item>
              <el-dropdown-item :command="'lang_zh'" :class="{ 'is-selected': locale === 'zh-CN' }">{{ t("common.chinese") }}</el-dropdown-item>
              <el-dropdown-item :command="'lang_en'" :class="{ 'is-selected': locale === 'en-US' }">{{ t("common.english") }}</el-dropdown-item>
              <el-dropdown-item divided disabled>{{ t("common.themeSystem") }} / {{ t("common.themeDark") }} / {{ t("common.themeLight") }}</el-dropdown-item>
              <el-dropdown-item :command="'theme_system'" :class="{ 'is-selected': theme === 'system' }">{{ t("common.themeSystem") }}</el-dropdown-item>
              <el-dropdown-item :command="'theme_dark'" :class="{ 'is-selected': theme === 'dark' }">{{ t("common.themeDark") }}</el-dropdown-item>
              <el-dropdown-item :command="'theme_light'" :class="{ 'is-selected': theme === 'light' }">{{ t("common.themeLight") }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <el-dropdown
        class="mobile-header-actions"
        trigger="click"
        popper-class="noobot-settings-dropdown"
        @command="handleHeaderAction"
      >
        <el-button
          class="mobile-menu-btn noobot-action-btn noobot-flat-soft-btn"
          native-type="button"
          :icon="MoreFilled"
          :title="t('common.moreActions')"
        />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="workspace">{{ t("common.workspace") }}</el-dropdown-item>
            <el-dropdown-item v-if="isSuperAdmin" command="user-settings">{{ t("common.userSettings") }}</el-dropdown-item>
            <el-dropdown-item command="config-params">{{ t("common.configParams") }}</el-dropdown-item>
            <el-dropdown-item divided command="lang_zh">{{ t("common.chinese") }}</el-dropdown-item>
            <el-dropdown-item command="lang_en">{{ t("common.english") }}</el-dropdown-item>
            <el-dropdown-item divided command="theme_system">{{ t("common.themeSystem") }}</el-dropdown-item>
            <el-dropdown-item command="theme_dark">{{ t("common.themeDark") }}</el-dropdown-item>
            <el-dropdown-item command="theme_light">{{ t("common.themeLight") }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

  </header>
</template>

<style scoped>
.chat-header {
  min-height: 64px;
  padding: 10px 24px 8px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  background: color-mix(in srgb, var(--noobot-panel-head-bg) 92%, transparent);
  border-bottom: 1px solid var(--noobot-border-weak);
  z-index: 10;
}

.chat-header-main {
  height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.mobile-menu-btn {
  display: none;
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  max-width: 34px;
  max-height: 34px;
  flex: 0 0 34px;
  padding: 0 !important;
  line-height: 1;
  aspect-ratio: 1 / 1;
}

.mobile-menu-btn :deep(.el-icon) {
  margin: 0 !important;
}

.header-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.header-spacer {
  flex: 1;
}

.workspace-btn {
  border-radius: 10px !important;
}

.desktop-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.settings-btn {
  width: 36px;
  min-width: 36px;
  padding: 0 !important;
}

.locale-select {
  width: 110px;
}

.theme-select {
  width: 104px;
}

.mobile-header-actions {
  display: none;
}

.head-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--noobot-text-strong);
}

.head-sub {
  font-size: 12px;
  color: var(--noobot-text-secondary);
  margin-top: 2px;
}

@media (max-width: 768px) {
  .mobile-menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .head-sub {
    display: none;
  }

  .locale-select,
  .theme-select {
    width: 84px;
  }

  .desktop-header-actions {
    display: none;
  }

  .mobile-header-actions {
    display: inline-flex;
  }

  .chat-header {
    min-height: 56px;
    padding: 0 max(12px, env(safe-area-inset-left)) 0 max(12px, env(safe-area-inset-right));
    gap: 6px;
  }

  .chat-header-main {
    height: 38px;
  }

}

@media (max-width: 1080px) {
  .desktop-header-actions {
    display: none;
  }

  .mobile-header-actions {
    display: inline-flex;
  }
}
</style>
