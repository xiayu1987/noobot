/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export const EXTRA_NARROW_BREAKPOINT = 480;
export const NARROW_BREAKPOINT = 640;
export const MOBILE_BREAKPOINT = 768;
export const PANEL_COLLAPSE_BREAKPOINT = 960;
export const HEADER_COLLAPSE_BREAKPOINT = 1080;
export const RESPONSIVE_BREAKPOINTS = Object.freeze([
  EXTRA_NARROW_BREAKPOINT,
  NARROW_BREAKPOINT,
  MOBILE_BREAKPOINT,
  PANEL_COLLAPSE_BREAKPOINT,
  HEADER_COLLAPSE_BREAKPOINT,
]);
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;
export const MOBILE_DRAWER_SIZE = "100%";
export const DESKTOP_DRAWER_SIZE = "72%";

export function resolveDrawerSize(isMobileViewport) {
  return isMobileViewport ? MOBILE_DRAWER_SIZE : DESKTOP_DRAWER_SIZE;
}

export function matchesMobileViewport() {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function useMobileViewport() {
  const isMobile = ref(false);
  const drawerSize = computed(() => resolveDrawerSize(isMobile.value));
  let mediaQuery = null;

  function syncViewport(event) {
    isMobile.value = event?.matches === true;
  }

  onMounted(() => {
    mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    syncViewport(mediaQuery);
    mediaQuery.addEventListener("change", syncViewport);
  });

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener("change", syncViewport);
    mediaQuery = null;
  });

  return { isMobile, drawerSize };
}
