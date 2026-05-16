/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const MOBILE_BREAKPOINT = 768;

function useThrottledResize(handler, delayMs = 150) {
  let timer = null;
  function throttled() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      handler();
    }, delayMs);
  }
  return throttled;
}

export function usePanelState() {
  const isMobile = ref(false);
  const sidebarCollapsed = ref(false);
  const mobileSidebarOpen = ref(false);
  const workspaceVisible = ref(false);
  const userSettingsVisible = ref(false);
  const configParamsVisible = ref(false);

  function updateViewportState() {
    isMobile.value = window.innerWidth <= MOBILE_BREAKPOINT;
    if (!isMobile.value) {
      mobileSidebarOpen.value = false;
    }
  }

  function toggleSidebar() {
    if (isMobile.value) {
      mobileSidebarOpen.value = !mobileSidebarOpen.value;
      return;
    }
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function closeMobileSidebar() {
    if (isMobile.value) mobileSidebarOpen.value = false;
  }

  function openMobileSidebar() {
    if (isMobile.value) mobileSidebarOpen.value = true;
  }

  function closeAllDrawers() {
    workspaceVisible.value = false;
    userSettingsVisible.value = false;
    configParamsVisible.value = false;
  }

  function openWorkspace() {
    closeAllDrawers();
    workspaceVisible.value = true;
  }

  function openUserSettings() {
    closeAllDrawers();
    userSettingsVisible.value = true;
  }

  function openConfigParams() {
    closeAllDrawers();
    configParamsVisible.value = true;
  }

  const drawerSize = computed(() => (isMobile.value ? "100%" : "72%"));

  const throttledResize = useThrottledResize(updateViewportState);

  onMounted(() => {
    updateViewportState();
    window.addEventListener("resize", throttledResize);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("resize", throttledResize);
  });

  return {
    isMobile,
    sidebarCollapsed,
    mobileSidebarOpen,
    workspaceVisible,
    userSettingsVisible,
    configParamsVisible,
    drawerSize,
    toggleSidebar,
    closeMobileSidebar,
    openMobileSidebar,
    closeAllDrawers,
    openWorkspace,
    openUserSettings,
    openConfigParams,
  };
}
