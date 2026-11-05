// 패널 폭 규칙(docs/design-contract.md 2.3절). 사용자가 정한 폭은 창을 줄여도 지우지 않아, 창을 늘리면 회복된다.
export const PANEL_MIN_W = 360;
export const PANEL_MAX_W = 560;
export const PANEL_DEFAULT_MAX_W = 440;
export const VIEWER_MIN_W = 440;
export const PANEL_KEY_STEP = 16;

export function panelMaxWidth(windowWidth: number): number {
  return Math.max(PANEL_MIN_W, Math.min(PANEL_MAX_W, windowWidth - VIEWER_MIN_W));
}

export function panelDefaultWidth(windowWidth: number): number {
  return Math.max(PANEL_MIN_W, Math.min(PANEL_DEFAULT_MAX_W, windowWidth * 0.33));
}

export function panelWidth(userWidth: number | null, windowWidth: number): number {
  const wanted = userWidth ?? panelDefaultWidth(windowWidth);
  return Math.round(Math.max(PANEL_MIN_W, Math.min(panelMaxWidth(windowWidth), wanted)));
}
