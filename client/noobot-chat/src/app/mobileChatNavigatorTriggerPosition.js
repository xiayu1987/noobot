export const MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION_STORAGE_KEY =
  "noobot_mobile_chat_navigator_trigger_position";

export const DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION = { right: 16, bottom: 112 };

export function loadMobileChatNavigatorTriggerPosition() {
  try {
    const rawValue = localStorage.getItem(MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION_STORAGE_KEY);
    if (!rawValue) return DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION;
    const parsed = JSON.parse(rawValue);
    const left = Number(parsed?.left);
    const top = Number(parsed?.top);
    return Number.isFinite(left) && Number.isFinite(top)
      ? { left, top }
      : DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION;
  } catch {
    return DEFAULT_MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION;
  }
}

export function clampMobileChatNavigatorTriggerPosition(left, top) {
  const triggerSize = 44;
  const edgeGap = 8;
  const viewportWidth = Number(window?.innerWidth || 0);
  const viewportHeight = Number(window?.innerHeight || 0);
  return {
    left: Math.min(
      Math.max(edgeGap, Number(left || 0)),
      Math.max(edgeGap, viewportWidth - triggerSize - edgeGap),
    ),
    top: Math.min(
      Math.max(edgeGap, Number(top || 0)),
      Math.max(edgeGap, viewportHeight - triggerSize - edgeGap),
    ),
  };
}

export function persistMobileChatNavigatorTriggerPosition(position = {}) {
  try {
    localStorage.setItem(
      MOBILE_CHAT_NAVIGATOR_TRIGGER_POSITION_STORAGE_KEY,
      JSON.stringify({
        left: Math.round(Number(position.left || 0)),
        top: Math.round(Number(position.top || 0)),
      }),
    );
  } catch {
    // Ignore storage quota/privacy errors.
  }
}
